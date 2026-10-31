use g_ann_package::{sha256, Package};
use serde_json::json;
use std::{fs, path::PathBuf};

fn fixture(tag: &str) -> (PathBuf, PathBuf, String) {
    let root = std::env::temp_dir().join(format!("gann-install-{tag}-{}", std::process::id()));
    fs::create_dir_all(root.join("source/audio")).unwrap();
    fs::create_dir_all(root.join("source/video")).unwrap();
    let ann = "ann_00000000-0000-0000-0000-000000000001";
    let original = "snd_00000000-0000-0000-0000-000000000002";
    let mixed = "snd_00000000-0000-0000-0000-000000000003";
    let banner = "bnr_00000000-0000-0000-0000-000000000004";
    let samples = [120i16, -120, 0, 0];
    let mut wav = Vec::new();
    wav.extend(b"RIFF");
    wav.extend((36u32 + 8).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(48000u32.to_le_bytes());
    wav.extend(96000u32.to_le_bytes());
    wav.extend(2u16.to_le_bytes());
    wav.extend(16u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(8u32.to_le_bytes());
    for sample in samples {
        wav.extend(sample.to_le_bytes());
    }
    let video = include_bytes!("fixtures/silent.webm");
    for id in [original, mixed] {
        fs::write(root.join(format!("source/audio/{id}.wav")), &wav).unwrap();
    }
    fs::write(root.join(format!("source/video/{banner}.webm")), video).unwrap();
    let registry = json!({"schema_version":1,"announcer_id":ann,"revision":1,"name":"Independent fixture","locale":"th",
        "sounds":[{"sound_id":original,"role":"original_voice","label":"Original","path":format!("audio/{original}.wav"),"sha256":sha256(&wav)},
                  {"sound_id":mixed,"role":"mixed_voice_sfx","label":"Played","path":format!("audio/{mixed}.wav"),"sha256":sha256(&wav)}],
        "components":[],"unmapped_sound_ids":[],"events":{"kill":[{"sound_id":original,"banner_id":banner}]},
        "banners":[{"banner_id":banner,"event_key":"kill","original_sound_id":original,"playback_sound_id":mixed,
            "visual_source":{"root":".","silent":true,"video":format!("video/{banner}.webm"),"sha256":sha256(video)},
            "components":[],"cues":[],"config":{"duration_seconds":1}}]});
    let manifest = format!("{ann}.json");
    fs::write(
        root.join("source").join(&manifest),
        serde_json::to_vec(&registry).unwrap(),
    )
    .unwrap();
    let package = root.join("fixture.gann");
    g_ann_package::create(&root.join("source"), &manifest, &package).unwrap();
    (root, package, ann.into())
}


#[test]
fn producer_compresses_wav_json_and_stores_webm() {
    let (root, path, _) = fixture("compression-policy");
    let mut zip = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
    for i in 0..zip.len() {
        let f = zip.by_index(i).unwrap();
        let expected = if f.name().starts_with("video/") { zip::CompressionMethod::Stored } else { zip::CompressionMethod::Deflated };
        assert_eq!(f.compression(), expected, "{}", f.name());
        assert_eq!(f.last_modified(), Some(zip::DateTime::default()));
        assert_eq!(f.unix_mode().unwrap() & 0o777, 0o644);
    }
    let second = root.join("second.gann");
    let ann = "ann_00000000-0000-0000-0000-000000000001.json";
    g_ann_package::create(&root.join("source"), ann, &second).unwrap();
    assert_eq!(fs::read(&path).unwrap(), fs::read(&second).unwrap());
    let report = g_ann_package::validate_producer_profile(&path).unwrap();
    assert_eq!(report.profile, "gann-zip-1");
    assert_eq!(report.container_bytes, fs::metadata(&path).unwrap().len());
    let p = Package::open(&path).unwrap();
    for e in &p.index.files {
        assert_eq!(p.read(&e.path).unwrap(), fs::read(root.join("source").join(&e.path)).unwrap());
    }
}

#[test]
fn registry_duplicate_fields_are_rejected() {
    use std::io::Write;
    let (root, _, ann) = fixture("duplicate-json");
    let manifest = format!("{ann}.json");
    let mut raw = fs::read_to_string(root.join("source").join(&manifest)).unwrap();
    raw = raw.replacen("\"name\":", "\"name\":\"spoofed\",\"name\":", 1);
    let mut indexed = vec![];
    for folder in ["audio", "video"] {
        for e in fs::read_dir(root.join("source").join(folder)).unwrap() {
            let e = e.unwrap(); let name = format!("{folder}/{}", e.file_name().to_str().unwrap());
            indexed.push((name, fs::read(e.path()).unwrap()));
        }
    }
    indexed.push((manifest.clone(), raw.into_bytes()));
    let index = serde_json::json!({"format":"g-ann-package","version":1,"announcer_id":ann,"manifest":manifest,"files":indexed.iter().map(|(path,b)| serde_json::json!({"path":path,"bytes":b.len(),"sha256":sha256(b)})).collect::<Vec<_>>()});
    let path = root.join("duplicate.gann");
    let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    zip.start_file("gann.json", zip::write::SimpleFileOptions::default()).unwrap();
    zip.write_all(&serde_json::to_vec(&index).unwrap()).unwrap();
    for (name,b) in indexed {zip.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();zip.write_all(&b).unwrap();}
    zip.finish().unwrap();
    assert!(Package::open(&path).is_err(), "duplicate registry keys must not be normalized away");
}

#[test]
fn producer_profile_rejects_hidden_zip_prefix_and_suffix() {
    let (root, path, _) = fixture("hidden-zip-data");
    let original = fs::read(&path).unwrap();
    let prefix = root.join("prefix.gann");
    fs::write(&prefix, [b"hidden".as_slice(), &original].concat()).unwrap();
    assert!(g_ann_package::validate_producer_profile(&prefix).is_err());
    let suffix = root.join("suffix.gann");
    fs::write(&suffix, [original.as_slice(), b"hidden"].concat()).unwrap();
    assert!(g_ann_package::validate_producer_profile(&suffix).is_err());
}

#[test]
fn producer_profile_rejects_conflicting_local_headers() {
    let (root, path, _) = fixture("conflicting-local-header");
    let original = fs::read(&path).unwrap();
    for offset in [30, 8, 10, 14] {
        let mut changed = original.clone(); changed[offset] ^= 1;
        let bad = root.join(format!("header-{offset}.gann"));
        fs::write(&bad, changed).unwrap();
        assert!(g_ann_package::validate_producer_profile(&bad).is_err(), "header {offset}");
    }
}

#[test]
fn duplicate_central_records_are_rejected_by_reader() {
    let (root, path, _) = fixture("duplicate-central");
    let original = fs::read(&path).unwrap();
    let end = original.len()-22;
    let mut tail = original[end..].to_vec();
    let central = u32::from_le_bytes(tail[16..20].try_into().unwrap()) as usize;
    let header = &original[central..];
    let len = 46 + u16::from_le_bytes(header[28..30].try_into().unwrap()) as usize
        + u16::from_le_bytes(header[30..32].try_into().unwrap()) as usize
        + u16::from_le_bytes(header[32..34].try_into().unwrap()) as usize;
    for offset in [8,10] {
        let count = u16::from_le_bytes(tail[offset..offset+2].try_into().unwrap());
        tail[offset..offset+2].copy_from_slice(&(count+1).to_le_bytes());
    }
    let size = u32::from_le_bytes(tail[12..16].try_into().unwrap());
    tail[12..16].copy_from_slice(&(size+len as u32).to_le_bytes());
    let bad = root.join("duplicate-central.gann");
    fs::write(&bad, [&original[..end], &original[central..central+len], &tail].concat()).unwrap();
    assert!(Package::open(&bad).is_err(), "ZIP library silently collapsed duplicate central record");
}
