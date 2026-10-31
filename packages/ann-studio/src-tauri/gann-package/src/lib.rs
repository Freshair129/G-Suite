//! Indexed .gann container. Imported authoring scripts are inert data.
mod install;
mod playback;
mod webm;
pub use install::{install, root_identity, InstalledPackage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
pub const MAX_PACKAGE: u64 = 512 * 1024 * 1024;
const MAX_FILE: u64 = 32 * 1024 * 1024;
const MAX_JSON: u64 = 2 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Index {
    pub format: String,
    pub version: u32,
    pub announcer_id: String,
    pub manifest: String,
    pub files: Vec<Entry>,
}
pub struct Package {
    pub index: Index,
    pub registry: Value,
    pub digest: String,
    path: PathBuf,
}
fn check(ok: bool, why: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(format!("GANN: {why}"))
    }
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn sha256(b: &[u8]) -> String {
    hex(ring::digest::digest(&ring::digest::SHA256, b).as_ref())
}
pub fn valid_id(id: &str, prefix: &str) -> bool {
    id.strip_prefix(prefix).is_some_and(|s| {
        let p: Vec<_> = s.split('-').collect();
        p.len() == 5
            && [8, 4, 4, 4, 12].iter().zip(p).all(|(n, s)| {
                s.len() == *n
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
    })
}
pub fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 240
        && name.is_ascii()
        && !name.contains(['\\', ':'])
        && name.split('/').all(|p| {
            let stem = p.split('.').next().unwrap_or("").to_ascii_uppercase();
            !p.is_empty()
                && p != "."
                && p != ".."
                && !p.ends_with([' ', '.'])
                && !p.bytes().any(|b| b < 32 || b"<>\"|?*".contains(&b))
                && !matches!(
                    stem.as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
}
pub fn file_digest(path: &Path) -> Result<String, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    check(
        f.metadata().map_err(|e| e.to_string())?.len() <= MAX_PACKAGE,
        "container size limit",
    )?;
    let mut c = ring::digest::Context::new(&ring::digest::SHA256);
    let mut buf = [0u8; 65536];
    let mut total = 0;
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        total += n as u64;
        check(total <= MAX_PACKAGE, "container grew")?;
        c.update(&buf[..n]);
    }
    Ok(hex(c.finish().as_ref()))
}
fn bytes<R: Read>(r: R, limit: u64) -> Result<Vec<u8>, String> {
    let mut b = Vec::new();
    r.take(limit + 1)
        .read_to_end(&mut b)
        .map_err(|e| e.to_string())?;
    check(b.len() as u64 <= limit, "entry size limit")?;
    Ok(b)
}
fn archive(path: &Path) -> Result<zip::ZipArchive<File>, String> {
    zip::ZipArchive::new(File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
impl Package {
    pub fn open(path: &Path) -> Result<Self, String> {
        let digest = file_digest(path)?;
        let mut zip = archive(path)?;
        check(zip.len() > 1 && zip.len() <= 2049, "entry count")?;
        let mut actual = BTreeMap::new();
        let mut folded = BTreeSet::new();
        let mut total = 0u64;
        for i in 0..zip.len() {
            let f = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = f.name().to_owned();
            check(
                !f.is_dir() && !f.is_symlink() && safe_name(&name),
                "unsafe archive entry",
            )?;
            check(
                folded.insert(name.to_ascii_lowercase()),
                "duplicate/case collision",
            )?;
            check(f.size() <= MAX_FILE, "entry too large")?;
            total = total.checked_add(f.size()).ok_or("size overflow")?;
            check(total <= MAX_PACKAGE, "expanded size limit")?;
            actual.insert(name, f.size());
        }
        let index: Index = serde_json::from_slice(&bytes(
            zip.by_name("gann.json").map_err(|_| "Missing gann.json")?,
            MAX_JSON,
        )?)
        .map_err(|e| e.to_string())?;
        check(
            index.format == "g-ann-package" && index.version == 1,
            "unsupported format version",
        )?;
        check(
            valid_id(&index.announcer_id, "ann_")
                && index.manifest == format!("{}.json", index.announcer_id),
            "manifest identity",
        )?;
        check(
            !index.files.is_empty()
                && index.files.len() <= 2048
                && actual.len() == index.files.len() + 1,
            "file index count",
        )?;
        let mut declared = BTreeSet::new();
        for e in &index.files {
            check(
                safe_name(&e.path) && e.path != "gann.json" && declared.insert(e.path.clone()),
                "invalid indexed path",
            )?;
            check(
                actual.get(&e.path) == Some(&e.bytes),
                "missing/size mismatch",
            )?;
            check(
                e.sha256.len() == 64
                    && e.sha256
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                "invalid hash",
            )?;
            let data = bytes(zip.by_name(&e.path).map_err(|e| e.to_string())?, e.bytes)?;
            check(
                data.len() as u64 == e.bytes && sha256(&data) == e.sha256,
                "entry hash mismatch",
            )?;
        }
        let raw = bytes(
            zip.by_name(&index.manifest)
                .map_err(|_| "Missing registry")?,
            MAX_JSON,
        )?;
        let registry: Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
        validate_registry(&registry, &index)?;
        check(
            file_digest(path)? == digest,
            "container changed during validation",
        )?;
        Ok(Self {
            index,
            registry,
            digest,
            path: path.to_owned(),
        })
    }
    pub fn read(&self, name: &str) -> Result<Vec<u8>, String> {
        let e = self
            .index
            .files
            .iter()
            .find(|e| e.path == name)
            .ok_or("File is not indexed")?;
        let mut zip = archive(&self.path)?;
        let b = bytes(zip.by_name(name).map_err(|e| e.to_string())?, e.bytes)?;
        check(
            b.len() as u64 == e.bytes && sha256(&b) == e.sha256,
            "file changed after open",
        )?;
        Ok(b)
    }
    pub fn extract(&self, dest: &Path) -> Result<(), String> {
        check(
            dest.is_dir()
                && fs::read_dir(dest)
                    .map_err(|e| e.to_string())?
                    .next()
                    .is_none(),
            "extraction target must be empty",
        )?;
        check(
            !fs::symlink_metadata(dest)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink(),
            "symlink target",
        )?;
        let root = dest.canonicalize().map_err(|e| e.to_string())?;
        for e in &self.index.files {
            let p = root.join(&e.path);
            let parent = p.parent().ok_or("file parent")?;
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            check(
                parent
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    .starts_with(&root),
                "extraction escaped root",
            )?;
            let mut f = File::options()
                .write(true)
                .create_new(true)
                .open(p)
                .map_err(|e| e.to_string())?;
            f.write_all(&self.read(&e.path)?)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn save_copy(&self, dest: &Path) -> Result<(), String> {
        check(!dest.exists(), "destination already exists")?;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let temp = dest.with_file_name(format!(".gann-copy-{}-{nonce}.tmp", std::process::id()));
        let result = (|| {
            let input = File::open(&self.path).map_err(|e| e.to_string())?;
            let mut out = File::options()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|e| e.to_string())?;
            std::io::copy(&mut input.take(MAX_PACKAGE + 1), &mut out).map_err(|e| e.to_string())?;
            out.sync_all().map_err(|e| e.to_string())?;
            drop(out);
            check(file_digest(&temp)? == self.digest, "copy digest mismatch")?;
            check(!dest.exists(), "destination appeared")?;
            fs::rename(&temp, dest).map_err(|e| e.to_string())
        })();
        if temp.is_file() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v[key].as_str().ok_or_else(|| format!("Missing {key}"))
}
fn array<'a>(v: &'a Value, key: &str) -> Result<&'a Vec<Value>, String> {
    v[key].as_array().ok_or_else(|| format!("Missing {key}"))
}
fn validate_registry(v: &Value, index: &Index) -> Result<(), String> {
    let name = text(v, "name")?;
    check(!name.trim().is_empty() && name.len() <= 256, "display name")?;
    check(
        v["schema_version"] == 1
            && v["announcer_id"] == index.announcer_id
            && v["revision"].as_u64().is_some_and(|n| n > 0),
        "registry identity/version",
    )?;
    let mut required = BTreeSet::from([index.manifest.clone()]);
    let mut sounds = BTreeMap::new();
    let mut banners = BTreeMap::new();
    for s in array(v, "sounds")? {
        let id = text(s, "sound_id")?;
        let path = text(s, "path")?;
        check(
            valid_id(id, "snd_")
                && path == format!("audio/{id}.wav")
                && sounds.insert(id, s).is_none(),
            "sound identity",
        )?;
        check(
            index
                .files
                .iter()
                .any(|e| e.path == path && e.sha256 == s["sha256"]),
            "sound file/hash reference",
        )?;
        required.insert(path.into());
    }
    for b in array(v, "banners")? {
        let event = text(b, "event_key")?;
        check(
            !event.is_empty()
                && event.len() <= 64
                && event
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_'),
            "event label",
        )?;
        let id = text(b, "banner_id")?;
        let path = text(&b["visual_source"], "video")?;
        check(
            valid_id(id, "bnr_")
                && banners.insert(id, b).is_none()
                && path == format!("video/{id}.webm"),
            "banner identity",
        )?;
        check(
            b["visual_source"]["root"] == "."
                && b["visual_source"]["silent"] == true
                && index
                    .files
                    .iter()
                    .any(|e| e.path == path && e.sha256 == b["visual_source"]["sha256"]),
            "visual reference",
        )?;
        check(
            sounds.contains_key(text(b, "original_sound_id")?)
                && sounds.contains_key(text(b, "playback_sound_id")?),
            "banner sound reference",
        )?;
        required.insert(path.into());
    }
    for (event, mappings) in v["events"].as_object().ok_or("Missing events")? {
        for m in mappings.as_array().ok_or("Invalid mapping")? {
            let b = banners
                .get(text(m, "banner_id")?)
                .ok_or("Dangling banner")?;
            check(
                b["event_key"] == *event && b["original_sound_id"] == m["sound_id"],
                "event pairing",
            )?;
        }
    }
    check(
        index
            .files
            .iter()
            .all(|e| required.contains(&e.path) || e.path.starts_with("motion/")),
        "undeclared payload outside motion stock",
    )
}
fn create_staged(root: &Path, manifest: &str, dest: &Path) -> Result<Package, String> {
    check(
        safe_name(manifest) && !manifest.contains('/'),
        "manifest name",
    )?;
    check(!dest.exists(), "destination exists")?;
    let raw = bytes(
        File::open(root.join(manifest)).map_err(|e| e.to_string())?,
        MAX_JSON,
    )?;
    let v: Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    let id = text(&v, "announcer_id")?.to_owned();
    let mut names = BTreeSet::from([manifest.to_owned()]);
    for s in array(&v, "sounds")? {
        names.insert(text(s, "path")?.into());
    }
    for b in array(&v, "banners")? {
        names.insert(text(&b["visual_source"], "video")?.into());
    }
    fn walk(root: &Path, dir: &Path, names: &mut BTreeSet<String>) -> Result<(), String> {
        for e in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            check(
                !e.file_type().map_err(|e| e.to_string())?.is_symlink(),
                "source symlink",
            )?;
            if e.path().is_dir() {
                walk(root, &e.path(), names)?
            } else {
                names.insert(
                    e.path()
                        .strip_prefix(root)
                        .map_err(|e| e.to_string())?
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
                check(names.len() <= 2048, "source file count")?;
            }
        }
        Ok(())
    }
    if root.join("motion").is_dir() {
        walk(root, &root.join("motion"), &mut names)?;
    }
    let mut entries = Vec::new();
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let mut total = 0u64;
    for name in &names {
        check(safe_name(name), "source path")?;
        let p = root.join(name).canonicalize().map_err(|e| e.to_string())?;
        check(p.starts_with(&canonical), "source escapes root")?;
        let b = bytes(File::open(p).map_err(|e| e.to_string())?, MAX_FILE)?;
        total += b.len() as u64;
        check(total <= MAX_PACKAGE, "source size")?;
        entries.push(Entry {
            path: name.clone(),
            bytes: b.len() as u64,
            sha256: sha256(&b),
        });
    }
    let index = Index {
        format: "g-ann-package".into(),
        version: 1,
        announcer_id: id,
        manifest: manifest.into(),
        files: entries,
    };
    validate_registry(&v, &index)?;
    let out = File::options()
        .write(true)
        .create_new(true)
        .open(dest)
        .map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(out);
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("gann.json", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(&serde_json::to_vec_pretty(&index).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for e in &index.files {
        let b = bytes(
            File::open(root.join(&e.path)).map_err(|e| e.to_string())?,
            e.bytes,
        )?;
        check(sha256(&b) == e.sha256, "source changed while packing")?;
        zip.start_file(&e.path, opts).map_err(|e| e.to_string())?;
        zip.write_all(&b).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Package::open(dest)
}

/// Commit a fully verified archive only after its temporary sibling passes admission.
pub fn create(root: &Path, manifest: &str, dest: &Path) -> Result<Package, String> {
    check(!dest.exists(), "destination exists")?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = dest.with_file_name(format!(".gann-build-{}-{nonce}.tmp", std::process::id()));
    let result = create_staged(root, manifest, &temporary).and_then(|_| {
        check(!dest.exists(), "destination appeared")?;
        fs::rename(&temporary, dest).map_err(|e| e.to_string())?;
        Package::open(dest)
    });
    if temporary.is_file() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
