//! One installer shared by the authoring app and the runtime importer.
use crate::{file_digest, sha256, Package};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Debug, Serialize)]
pub struct InstalledPackage {
    pub pack_id: String,
    pub pack_dir: PathBuf,
    pub container_sha256: String,
    pub voice_root_id: String,
}
/// Local activation binds to this cache identity without disclosing its path.
pub fn root_identity(root: &Path) -> Result<String, String> {
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let path = canonical.to_str().ok_or("Voice root is not Unicode")?;
    #[cfg(windows)]
    let normalized = path.replace('\\', "/").to_lowercase();
    #[cfg(not(windows))]
    let normalized = path.to_string();
    Ok(sha256(normalized.as_bytes()))
}
#[derive(Serialize, Deserialize)]
struct Origin {
    announcer_id: String,
    container_sha256: String,
    manifest_sha256: String,
}

fn verify_cache(package: &Package, dest: &Path) -> Result<(), String> {
    let root = dest.canonicalize().map_err(|e| e.to_string())?;
    for entry in &package.index.files {
        let path = dest
            .join(&entry.path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !path.starts_with(&root) {
            return Err("Installed cache escaped pack directory".into());
        }
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(entry.bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 != entry.bytes || sha256(&bytes) != entry.sha256 {
            return Err(format!("Installed GANN cache mismatch: {}", entry.path));
        }
    }
    Ok(())
}

pub fn install(source: &Path, voice_root: &Path) -> Result<InstalledPackage, String> {
    static INSTALL: Mutex<()> = Mutex::new(());
    let _lock = INSTALL
        .try_lock()
        .map_err(|_| "Another GANN install is running")?;
    if source
        .extension()
        .and_then(|s| s.to_str())
        .is_none_or(|s| !s.eq_ignore_ascii_case("gann"))
    {
        return Err("Choose a .gann file".into());
    }
    let package = Package::open(source)?;
    package.validate_playback()?;
    let packs = voice_root.join("packs");
    let containers = voice_root.join("containers");
    fs::create_dir_all(&packs).map_err(|e| e.to_string())?;
    fs::create_dir_all(&containers).map_err(|e| e.to_string())?;
    let voice_root_id = root_identity(voice_root)?;
    let dest = packs.join(&package.index.announcer_id);
    let archive = containers.join(format!("{}.gann", package.digest));
    let report = || InstalledPackage {
        pack_id: package.index.announcer_id.clone(),
        pack_dir: dest.clone(),
        container_sha256: package.digest.clone(),
        voice_root_id: voice_root_id.clone(),
    };
    if dest.exists() {
        let file = fs::File::open(dest.join("local-gann.json"))
            .map_err(|_| "Existing pack is not a GANN installation")?;
        let mut bytes = Vec::new();
        file.take(4097)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 4096 {
            return Err("Invalid existing GANN origin".into());
        }
        let origin: Origin = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let manifest = package
            .index
            .files
            .iter()
            .find(|e| e.path == package.index.manifest)
            .ok_or("Missing manifest")?;
        if origin.announcer_id != package.index.announcer_id
            || origin.container_sha256 != package.digest
            || origin.manifest_sha256 != manifest.sha256
        {
            return Err(
                "Same announcer ID has different content; installed package was preserved".into(),
            );
        }
        if file_digest(&archive)? != package.digest {
            return Err("Stored GANN container mismatch".into());
        }
        verify_cache(&package, &dest)?;
        return Ok(report());
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let stage = packs.join(format!(".gann-install-{}-{nonce}", std::process::id()));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        package.extract(&stage)?;
        verify_cache(&package, &stage)?;
        if archive.exists() {
            if file_digest(&archive)? != package.digest {
                return Err("Stored GANN container mismatch".into());
            }
        } else {
            package.save_copy(&archive)?;
        }
        let manifest = package
            .index
            .files
            .iter()
            .find(|e| e.path == package.index.manifest)
            .ok_or("Missing manifest")?;
        let origin = Origin {
            announcer_id: package.index.announcer_id.clone(),
            container_sha256: package.digest.clone(),
            manifest_sha256: manifest.sha256.clone(),
        };
        fs::write(
            stage.join("local-gann.json"),
            serde_json::to_vec(&origin).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if dest.exists() {
            return Err("Destination appeared during install".into());
        }
        fs::rename(&stage, &dest).map_err(|e| e.to_string())?;
        Ok(report())
    })();
    if stage.is_dir() {
        let root = packs.canonicalize().map_err(|e| e.to_string())?;
        let target = stage.canonicalize().map_err(|e| e.to_string())?;
        if target != root && target.starts_with(root) {
            let _ = fs::remove_dir_all(target);
        }
    }
    result
}
