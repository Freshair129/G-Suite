use g_ann_package::{sha256, Package};
use serde_json::json;
use std::{fs, path::PathBuf, process::Command};

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
fn cli_install_preserves_container_and_verified_pairs_without_activation() {
    let (root, package, ann) = fixture("cli");
    let voice = root.join("voice");
    let result = Command::new(env!("CARGO_BIN_EXE_g-ann-package"))
        .args([
            "install",
            package.to_str().unwrap(),
            voice.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(report["pack_id"], ann);
    assert!(
        report["voice_root_id"]
            .as_str()
            .is_some_and(|s| s.len() == 64),
        "installer must identify selected runtime root"
    );
    let opened = Package::open(&package).unwrap();
    assert_eq!(
        fs::read(
            voice
                .join("containers")
                .join(format!("{}.gann", opened.digest))
        )
        .unwrap(),
        fs::read(&package).unwrap()
    );
    let installed = voice.join("packs").join(&ann);
    for entry in &opened.index.files {
        assert_eq!(
            sha256(&fs::read(installed.join(&entry.path)).unwrap()),
            entry.sha256
        );
    }
    assert!(installed.join("local-gann.json").is_file());
    assert!(!voice.join("active-pack.txt").exists());
    assert!(!installed.join("manifest.json").exists());
    let repeat = Command::new(env!("CARGO_BIN_EXE_g-ann-package"))
        .args([
            "install",
            package.to_str().unwrap(),
            voice.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(repeat.status.success());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cli_install_rejects_incomplete_playback_schema_without_touching_selection() {
    let (root, _, ann) = fixture("schema");
    let path = root.join("source").join(format!("{ann}.json"));
    let mut v: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    v.as_object_mut().unwrap().remove("locale");
    fs::write(path, serde_json::to_vec(&v).unwrap()).unwrap();
    let package = root.join("incomplete.gann");
    g_ann_package::create(&root.join("source"), &format!("{ann}.json"), &package).unwrap();
    let voice = root.join("voice");
    fs::create_dir(&voice).unwrap();
    fs::write(voice.join("active-pack.txt"), "keep-existing").unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_g-ann-package"))
        .args([
            "install",
            package.to_str().unwrap(),
            voice.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert_eq!(
        fs::read_to_string(voice.join("active-pack.txt")).unwrap(),
        "keep-existing"
    );
    assert!(!voice.join("packs").join(ann).exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn playback_validation_rejects_extreme_wav_rate_without_panicking() {
    let (root, _, ann) = fixture("rate");
    let manifest = root.join("source").join(format!("{ann}.json"));
    let mut registry: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
    let sound = &mut registry["sounds"][0];
    let wav_path = root.join("source").join(sound["path"].as_str().unwrap());
    let mut wav = fs::read(&wav_path).unwrap();
    wav[24..28].copy_from_slice(&u32::MAX.to_le_bytes());
    fs::write(wav_path, &wav).unwrap();
    sound["sha256"] = sha256(&wav).into();
    fs::write(manifest, serde_json::to_vec(&registry).unwrap()).unwrap();
    let package = root.join("invalid-rate.gann");
    let opened =
        g_ann_package::create(&root.join("source"), &format!("{ann}.json"), &package).unwrap();
    assert!(opened.validate_playback().is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn install_rejects_cache_tampering_and_conflicting_revision_preserving_selection() {
    let (root, package, ann) = fixture("conflict");
    let voice = root.join("voice");
    let installed = g_ann_package::install(&package, &voice).unwrap();
    fs::write(voice.join("active-pack.txt"), &ann).unwrap();
    let registry_path = root.join("source").join(format!("{ann}.json"));
    let mut registry: serde_json::Value =
        serde_json::from_slice(&fs::read(&registry_path).unwrap()).unwrap();
    registry["revision"] = 2.into();
    fs::write(registry_path, serde_json::to_vec(&registry).unwrap()).unwrap();
    let conflict = root.join("conflict.gann");
    g_ann_package::create(&root.join("source"), &format!("{ann}.json"), &conflict).unwrap();
    assert!(g_ann_package::install(&conflict, &voice).is_err());
    let original = g_ann_package::Package::open(&package).unwrap();
    let audio = original
        .index
        .files
        .iter()
        .find(|e| e.path.starts_with("audio/"))
        .unwrap();
    fs::write(installed.pack_dir.join(&audio.path), b"tampered").unwrap();
    assert!(g_ann_package::install(&package, &voice).is_err());
    assert_eq!(
        fs::read_to_string(voice.join("active-pack.txt")).unwrap(),
        ann
    );
    assert_eq!(
        fs::read(
            voice
                .join("containers")
                .join(format!("{}.gann", original.digest))
        )
        .unwrap(),
        fs::read(package).unwrap()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn playback_validation_rejects_nonvideo_truncation_and_audible_visual_tracks() {
    for (tag, video) in [
        ("header-only", &[0x1a, 0x45, 0xdf, 0xa3, 0x80][..]),
        ("truncated", &include_bytes!("fixtures/silent.webm")[..100]),
        ("audible", &include_bytes!("fixtures/with-audio.webm")[..]),
    ] {
        let (root, _, ann) = fixture(tag);
        let manifest = root.join("source").join(format!("{ann}.json"));
        let mut registry: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
        let visual = &mut registry["banners"][0]["visual_source"];
        fs::write(
            root.join("source").join(visual["video"].as_str().unwrap()),
            video,
        )
        .unwrap();
        visual["sha256"] = sha256(video).into();
        fs::write(manifest, serde_json::to_vec(&registry).unwrap()).unwrap();
        let package = root.join("bad-video.gann");
        let p =
            g_ann_package::create(&root.join("source"), &format!("{ann}.json"), &package).unwrap();
        assert!(
            p.validate_playback().is_err(),
            "{tag} is not a silent playable video"
        );
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn unused_authoring_bucket_cannot_be_admitted_as_a_runtime_event() {
    let (root, _, ann) = fixture("unused");
    let manifest = root.join("source").join(format!("{ann}.json"));
    let mut registry: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
    let mapping = registry["events"]
        .as_object_mut()
        .unwrap()
        .remove("kill")
        .unwrap();
    registry["events"]["unused"] = mapping;
    registry["banners"][0]["event_key"] = "unused".into();
    fs::write(manifest, serde_json::to_vec(&registry).unwrap()).unwrap();
    let p = g_ann_package::create(
        &root.join("source"),
        &format!("{ann}.json"),
        &root.join("unused.gann"),
    )
    .unwrap();
    assert!(
        p.validate_playback().is_err(),
        "the unassigned authoring bucket is not a runtime event"
    );
    fs::remove_dir_all(root).unwrap();
}
