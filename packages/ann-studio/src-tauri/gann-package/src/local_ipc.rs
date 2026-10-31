//! Profile-bound, current-Windows-user installation transport. This authenticates
//! the OS user and registered server, not arbitrary applications of that user.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::{Path, PathBuf}};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const MAX_FRAME: usize = 16384;
pub const PROTOCOL_VERSION: u32 = 1;
pub const CAPABILITY: &str = "local-install-v1";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Handshake { pub protocol_version: u32, pub profile_id: String, pub nonce: String }
impl Handshake {
    pub fn new(profile_id: String, nonce: String) -> Self { Self { protocol_version: PROTOCOL_VERSION, profile_id, nonce } }
    pub fn validate(&self, actual: &Self) -> Result<(), String> {
        if self != actual || self.protocol_version != PROTOCOL_VERSION { return Err("profile_nonce_protocol_mismatch".into()); }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all="snake_case")]
pub enum EquipPolicy { Never, NowIfIdle, AfterMatch }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalInstall {
    pub protocol_version: u32, pub request_id: String, pub profile_id: String,
    pub source_path: PathBuf, pub expected_digest: String,
    pub project_binding: Option<String>, pub equip_policy: EquipPolicy,
}
fn valid_label(s: &str) -> bool { !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)) }
impl LocalInstall {
    pub fn validate(&self) -> Result<(), String> {
        if self.protocol_version != PROTOCOL_VERSION || !valid_label(&self.request_id) || !valid_label(&self.profile_id) { return Err("invalid_request_identity".into()); }
        let source = self.source_path.to_str().ok_or("source_path_encoding")?;
        if source.len() > 8192 || source.contains('\0') || !self.source_path.is_absolute() { return Err("invalid_source_path".into()); }
        if self.expected_digest.len() != 64 || !self.expected_digest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) { return Err("invalid_expected_digest".into()); }
        if self.project_binding.as_ref().is_some_and(|b| b.len() > 256) { return Err("invalid_project_binding".into()); }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registration {
    pub profile_id: String, pub display_name: String, pub instance_kind: String,
    pub protocol_version: u32, pub capability: String, pub endpoint: String,
    pub nonce: String, pub owner_sid: String, pub process_id: u32,
    pub executable: PathBuf, pub executable_sha256: String, pub app_local_data: PathBuf,
}
impl Registration {
    pub fn handshake(&self) -> Handshake { Handshake::new(self.profile_id.clone(), self.nonce.clone()) }
    pub fn validate(&self) -> Result<(), String> {
        if !valid_label(&self.profile_id) || self.protocol_version != PROTOCOL_VERSION || self.capability != CAPABILITY
            || self.nonce.len() != 64 || !self.nonce.bytes().all(|b| b.is_ascii_hexdigit())
            || self.endpoint != format!(r"\\.\pipe\G-Maiden-package-{}-{}", self.profile_id, self.nonce)
            || !self.executable.is_absolute() || !self.app_local_data.is_absolute() { return Err("invalid_registration".into()); }
        Ok(())
    }
    pub fn verify_binary(&self) -> Result<(), String> {
        self.validate()?;
        if crate::file_digest(&self.executable)? != self.executable_sha256 { return Err("registered_binary_changed".into()); }
        Ok(())
    }
}
pub fn select_registration<'a>(registrations: &'a [Registration], profile: &str) -> Result<&'a Registration, String> {
    let found: Vec<_> = registrations.iter().filter(|r| r.profile_id == profile).collect();
    if found.len() != 1 { return Err("profile_not_registered".into()); }
    found[0].verify_binary()?;
    Ok(found[0])
}
pub fn registration_directory() -> Result<PathBuf, String> {
    Ok(PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA unavailable")?).join("G-Maiden/package-profiles"))
}
pub fn discover(directory: &Path) -> Vec<Registration> {
    fs::read_dir(directory).ok().into_iter().flatten().flatten().filter_map(|e| {
        let metadata = e.metadata().ok()?;
        if metadata.len() > MAX_FRAME as u64 || !metadata.is_file() { return None; }
        let r: Registration = serde_json::from_slice(&fs::read(e.path()).ok()?).ok()?;
        r.verify_binary().ok()?;
        #[cfg(windows)] if r.owner_sid != windows::current_sid().ok()? { return None; }
        Some(r)
    }).take(64).collect()
}
pub fn decode_frame(bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() > MAX_FRAME { return Err("ipc_frame_too_large".into()); }
    crate::strict_json::parse(bytes).map_err(|_| "ipc_invalid_json".into())
}
async fn read_frame<R: AsyncRead + Unpin>(stream: &mut R) -> Result<Value, String> {
    let count = stream.read_u32_le().await.map_err(|e| e.to_string())? as usize;
    if count > MAX_FRAME { return Err("ipc_frame_too_large".into()); }
    let mut bytes = vec![0; count]; stream.read_exact(&mut bytes).await.map_err(|e| e.to_string())?;
    decode_frame(&bytes)
}
async fn write_frame<W: AsyncWrite + Unpin>(stream: &mut W, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_FRAME { return Err("ipc_frame_too_large".into()); }
    stream.write_u32_le(bytes.len() as u32).await.map_err(|e| e.to_string())?;
    stream.write_all(&bytes).await.map_err(|e| e.to_string())?;
    stream.flush().await.map_err(|e| e.to_string())
}
pub fn random_nonce() -> Result<String, String> {
    use ring::rand::SecureRandom;
    let mut bytes = [0;32]; ring::rand::SystemRandom::new().fill(&mut bytes).map_err(|_| "random unavailable")?;
    Ok(bytes.iter().map(|b|format!("{b:02x}")).collect())
}

#[cfg(windows)]
pub mod windows {
    use super::*;
    use std::{ffi::c_void, os::windows::io::AsRawHandle, ptr};
    use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};
    use windows_sys::Win32::{Foundation::{CloseHandle, LocalFree, HANDLE}, Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER, SECURITY_ATTRIBUTES}, Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW}, System::{Threading::{GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION}, Pipes::{GetNamedPipeClientProcessId, GetNamedPipeServerProcessId}}};
    struct Owned(HANDLE);
    impl Drop for Owned { fn drop(&mut self) { unsafe { CloseHandle(self.0); } } }
    fn sid(process: HANDLE) -> Result<String, String> {
        unsafe {
            let mut token = ptr::null_mut();
            if OpenProcessToken(process, TOKEN_QUERY, &mut token) == 0 { return Err("peer_token_unavailable".into()); }
            let token = Owned(token); let mut size = 0;
            GetTokenInformation(token.0, TokenUser, ptr::null_mut(), 0, &mut size);
            if size == 0 || size > 65536 { return Err("peer_token_size".into()); }
            let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
            if GetTokenInformation(token.0, TokenUser, buffer.as_mut_ptr().cast(), size, &mut size) == 0 { return Err("peer_token_unavailable".into()); }
            let user = &*buffer.as_ptr().cast::<TOKEN_USER>(); let mut text = ptr::null_mut();
            if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 { return Err("peer_sid_unavailable".into()); }
            let mut len = 0; while *text.add(len) != 0 { len += 1; }
            let result = String::from_utf16(std::slice::from_raw_parts(text, len)).map_err(|_|"peer_sid_encoding".into());
            LocalFree(text.cast()); result
        }
    }
    pub fn current_sid() -> Result<String, String> { unsafe { sid(GetCurrentProcess()) } }
    pub fn process_identity(pid: u32) -> Result<(String, PathBuf), String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() { return Err("registered_process_not_running".into()); }
            let process = Owned(handle); let owner = sid(process.0)?;
            let mut path = vec![0u16;32768]; let mut size = path.len() as u32;
            if QueryFullProcessImageNameW(process.0, 0, path.as_mut_ptr(), &mut size) == 0 { return Err("peer_binary_unavailable".into()); }
            Ok((owner, PathBuf::from(String::from_utf16(&path[..size as usize]).map_err(|_| "peer_binary_encoding")?)))
        }
    }
    fn check_peer(pid: u32, registration: &Registration, server: bool) -> Result<(), String> {
        let (owner, path) = process_identity(pid)?;
        if owner != current_sid()? || owner != registration.owner_sid { return Err("another_user_denied".into()); }
        if server && (pid != registration.process_id || fs::canonicalize(path).map_err(|e|e.to_string())? != fs::canonicalize(&registration.executable).map_err(|e|e.to_string())?) { return Err("registered_server_mismatch".into()); }
        Ok(())
    }
    pub fn new_registration(profile_id: String, display_name: String, instance_kind: String, app_local_data: PathBuf) -> Result<Registration,String> {
        let executable = std::env::current_exe().map_err(|e|e.to_string())?;
        let nonce = random_nonce()?;
        let r = Registration { endpoint:format!(r"\\.\pipe\G-Maiden-package-{profile_id}-{nonce}"), profile_id, display_name, instance_kind,
            protocol_version: PROTOCOL_VERSION, capability: CAPABILITY.into(), nonce, owner_sid:current_sid()?, process_id:std::process::id(),
            executable_sha256:crate::file_digest(&executable)?, executable, app_local_data };
        r.validate()?; Ok(r)
    }
    pub fn publish(registration: &Registration, directory: &Path) -> Result<(),String> {
        registration.verify_binary()?;
        fs::create_dir_all(directory).map_err(|e|e.to_string())?;
        let bytes = serde_json::to_vec_pretty(registration).map_err(|e|e.to_string())?;
        if bytes.len() > MAX_FRAME { return Err("registration_too_large".into()); }
        let dest = directory.join(format!("{}.json", registration.profile_id));
        let temp = directory.join(format!(".{}-{}.tmp",registration.profile_id, registration.nonce));
        fs::write(&temp, bytes).map_err(|e|e.to_string())?;
        fs::rename(temp, dest).map_err(|e|e.to_string())
    }
    fn create_pipe(registration: &Registration, first: bool) -> Result<NamedPipeServer,String> {
        unsafe {
            let sddl: Vec<u16> = format!("D:P(A;;GA;;;{})", registration.owner_sid).encode_utf16().chain(Some(0)).collect();
            let mut descriptor: *mut c_void = ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut descriptor, ptr::null_mut()) == 0 { return Err("pipe_acl_failed".into()); }
            let mut attributes = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor:descriptor, bInheritHandle:0 };
            let result = ServerOptions::new().first_pipe_instance(first).reject_remote_clients(true).max_instances(8)
                .create_with_security_attributes_raw(&registration.endpoint, (&mut attributes as *mut SECURITY_ATTRIBUTES).cast()).map_err(|e|e.to_string());
            LocalFree(descriptor); result
        }
    }
    pub async fn serve(registration: Registration, directory: PathBuf, handler: std::sync::Arc<dyn Fn(Value)->Value + Send + Sync>) -> Result<(),String> {
        registration.verify_binary()?;
        if registration.owner_sid != current_sid()? { return Err("another_user_denied".into()); }
        let mut listener = create_pipe(&registration, true)?;
        publish(&registration, &directory)?;
        let slots = std::sync::Arc::new(tokio::sync::Semaphore::new(4));
        loop {
            listener.connect().await.map_err(|e|e.to_string())?;
            let mut stream = listener;
            listener = create_pipe(&registration, false)?;
            let Ok(permit) = slots.clone().try_acquire_owned() else { continue };
            let registration = registration.clone(); let handler = handler.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let exchange = async {
                    let mut pid=0;
                    if unsafe { GetNamedPipeClientProcessId(stream.as_raw_handle(), &mut pid) } == 0 { return Err("peer_pid_unavailable".into()); }
                    check_peer(pid, &registration, false)?;
                    let hello: Handshake = serde_json::from_value(read_frame(&mut stream).await?).map_err(|_|"invalid_handshake")?;
                    registration.handshake().validate(&hello)?;
                    write_frame(&mut stream, &serde_json::json!({"handshake":hello,"capability":CAPABILITY})).await?;
                    let request = read_frame(&mut stream).await?;
                    let response = tokio::task::spawn_blocking(move || handler(request)).await.map_err(|e|e.to_string())?;
                    write_frame(&mut stream, &response).await
                };
                let _: Result<Result<(),String>,_> = tokio::time::timeout(std::time::Duration::from_secs(120), exchange).await;
            });
        }
    }
    pub async fn request(registration: &Registration, request: Value) -> Result<Value,String> {
        registration.verify_binary()?;
        check_peer(registration.process_id, registration, true)?;
        let exchange = async {
            let mut stream = ClientOptions::new().open(&registration.endpoint).map_err(|e|e.to_string())?;
            let mut pid=0;
            if unsafe { GetNamedPipeServerProcessId(stream.as_raw_handle(), &mut pid) } == 0 { return Err("peer_pid_unavailable".into()); }
            check_peer(pid,registration,true)?;
            write_frame(&mut stream,&serde_json::to_value(registration.handshake()).map_err(|e|e.to_string())?).await?;
            let response = read_frame(&mut stream).await?;
            let hello: Handshake=serde_json::from_value(response["handshake"].clone()).map_err(|_|"invalid_handshake")?;
            registration.handshake().validate(&hello)?;
            if response["capability"] != CAPABILITY { return Err("unsupported_capability".into()); }
            write_frame(&mut stream,&request).await?; read_frame(&mut stream).await
        };
        tokio::time::timeout(std::time::Duration::from_secs(120),exchange).await.map_err(|_|"ipc_timeout".to_string())?
    }
}
