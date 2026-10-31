use crate::{Package, MAX_PACKAGE};
use std::{fs::File, path::Path, io::{Read, Seek, SeekFrom}};

pub const PRODUCER_PROFILE: &str = "gann-zip-1";

pub(crate) fn validate_entry_count(path: &Path, count: usize) -> Result<(),String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let length = size.min(65557) as usize;
    file.seek(SeekFrom::End(-(length as i64))).map_err(|e| e.to_string())?;
    let mut end = vec![0u8; length];
    file.read_exact(&mut end).map_err(|e| e.to_string())?;
    let pos = end.windows(4).enumerate().rev().find_map(|(i,b)| {
        if b == b"PK\x05\x06" && i+22 <= end.len() {
            let comment = u16::from_le_bytes([end[i+20],end[i+21]]) as usize;
            if i+22+comment == end.len() { return Some(i); }
        }
        None
    }).ok_or("GANN: invalid end record")?;
    for offset in [8,10] {
        if u16::from_le_bytes([end[pos+offset],end[pos+offset+1]]) as usize != count {
            return Err("GANN: duplicate or inconsistent ZIP records".into());
        }
    }
    Ok(())
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct CompressionReport {
    pub profile: String,
    pub container_bytes: u64,
    pub expanded_bytes: u64,
    pub entry_count: usize,
}

fn method(path: &str) -> zip::CompressionMethod {
    if path.starts_with("video/") && path.ends_with(".webm") {
        zip::CompressionMethod::Stored
    } else {
        zip::CompressionMethod::Deflated
    }
}

pub(crate) fn options(path: &str) -> zip::write::SimpleFileOptions {
    let method = method(path);
    zip::write::SimpleFileOptions::default()
        .compression_method(method)
        .compression_level((method == zip::CompressionMethod::Deflated).then_some(6))
        .last_modified_time(zip::DateTime::default())
        .unix_permissions(0o644)
}

pub fn validate_producer_profile(path: &Path) -> Result<CompressionReport, String> {
    let package = Package::open(path)?;
    let file = File::open(path).map_err(|e| e.to_string())?;
    let container_bytes = file.metadata().map_err(|e| e.to_string())?.len();
    let mut tail_file = File::open(path).map_err(|e| e.to_string())?;
    tail_file.seek(SeekFrom::End(-22)).map_err(|e| e.to_string())?;
    let mut tail = [0u8;22];
    tail_file.read_exact(&mut tail).map_err(|e| e.to_string())?;
    if &tail[..4] != b"PK\x05\x06" || tail[4..8] != [0,0,0,0] || tail[20..] != [0,0] {
        return Err("GANN profile: end record or trailing data".into());
    }
    let central_size = u32::from_le_bytes(tail[12..16].try_into().unwrap()) as u64;
    let central_start = u32::from_le_bytes(tail[16..20].try_into().unwrap()) as u64;
    if central_start + central_size + 22 != container_bytes {
        return Err("GANN profile: central directory bounds".into());
    }
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    if archive.offset() != 0 || !archive.comment().is_empty() { return Err("GANN profile: ZIP comment".into()); }
    let mut previous = String::new();
    let mut total = 0u64;
    let mut next_header = 0u64;
    let mut next_central = central_start;
    let mut raw = File::open(path).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let f = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = f.name();
        if (i == 0 && name != "gann.json") || (i > 1 && name <= previous.as_str()) {
            return Err("GANN profile: entry order".into());
        }
        if f.compression() != method(name)
            || f.last_modified() != Some(zip::DateTime::default())
            || f.unix_mode().map(|m| m & 0o777) != Some(0o644) {
            return Err(format!("GANN profile: entry metadata: {name}"));
        }
        if f.encrypted() || !f.comment().is_empty() || f.extra_data().is_some_and(|e| !e.is_empty())
            || f.header_start() != next_header || f.data_start() != f.header_start() + 30 + name.len() as u64 {
            return Err("GANN profile: hidden data or entry extras".into());
        }
        next_header = f.data_start() + f.compressed_size();
        let mut local = [0u8;30];
        raw.seek(SeekFrom::Start(f.header_start())).map_err(|e| e.to_string())?;
        raw.read_exact(&mut local).map_err(|e| e.to_string())?;
        let mut local_name = vec![0u8;name.len()];
        raw.read_exact(&mut local_name).map_err(|e| e.to_string())?;
        let mut central = [0u8;46];
        raw.seek(SeekFrom::Start(f.central_header_start())).map_err(|e| e.to_string())?;
        raw.read_exact(&mut central).map_err(|e| e.to_string())?;
        let mut central_name = vec![0u8;name.len()];
        raw.read_exact(&mut central_name).map_err(|e| e.to_string())?;
        let flags = u16::from_le_bytes([local[6],local[7]]);
        if &local[..4] != b"PK\x03\x04" || &central[..4] != b"PK\x01\x02"
            || local[6..26] != central[8..28] || flags & !0x800 != 0
            || local_name != name.as_bytes() || central_name != name.as_bytes()
            || u16::from_le_bytes([local[26],local[27]]) as usize != name.len()
            || u16::from_le_bytes([central[28],central[29]]) as usize != name.len()
            || local[28..30] != [0,0] || central[30..38] != [0;8]
            || f.central_header_start() != next_central {
            return Err("GANN profile: conflicting ZIP headers".into());
        }
        next_central += 46 + name.len() as u64;
        previous = name.to_owned();
        total = total.checked_add(f.size()).ok_or("GANN expanded overflow")?;
        if total > MAX_PACKAGE { return Err("GANN expanded size".into()); }
    }
    if next_header != central_start || next_central != container_bytes - 22 || crate::file_digest(path)? != package.digest {
        return Err("GANN profile: layout or container changed".into());
    }
    Ok(CompressionReport { profile: PRODUCER_PROFILE.into(), container_bytes, expanded_bytes: total, entry_count: archive.len() })
}
