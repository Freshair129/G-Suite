use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

fn root() -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let path = std::env::temp_dir().join(format!(
        "ann-project-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}
fn snapshot() -> Value {
    json!({"project":{"schemaVersion":2,"projectId":"00000000-0000-4000-8000-000000000001","announcerId":"ann_00000000-0000-4000-8000-000000000002","name":"แพ็กไทย","author":"ผู้สร้าง","locale":"th-TH","currentRevision":2,
    "assets":[{"id":"asset-one","relativePath":"assets/pending.wav","sha256":"","mediaType":"audio/wav","sourceMetadata":{"originalName":"เสียง.wav"}}],
    "variants":[{"id":"second","originalSoundId":"snd_00000000-0000-4000-8000-000000000003","mixedSoundId":"snd_00000000-0000-4000-8000-000000000004","bannerId":"bnr_00000000-0000-4000-8000-000000000005","voiceAssetId":"asset-one","voiceClip":{"id":"second","name":"คำบรรยาย","start":0,"end":1,"event":"kill","color":"#fff"},"bannerProject":{"layers":[{"content":{"text":"ตัวแปรที่สอง"},"style":{"fontFamily":"Noto Sans Thai"}}]},"sfxCues":[{"assetId":"asset-one","startMs":200,"gainDb":-3,"trimStartMs":0,"trimEndMs":400,"fadeInMs":0,"fadeOutMs":20}],"audioEndMs":1000,"videoEndMs":1200}],
    "eventMappings":[{"eventKey":"kill","variantIds":["second"]}],"inactiveStock":[],"templates":[{"id":"thai-font","version":"1","assetIds":["asset-one"]}],"buildHistory":[{"revision":2,"digest":"abc"}],"editor":{"sourceAssetId":"asset-one","wavAssetId":"asset-one","duration":1,"clips":[],"bannerProject":{"layers":[]},"bannerOverrides":{},"packBuilder":{},"trackItems":[],"trackCount":3,"masterVolume":1,"overlayLayout":{}}},"generation":4,"fingerprint":""})
}

#[test]
fn portable_archive_survives_deleted_source_and_preserves_second_variant() {
    let root = root();
    let source = root.join("ต้นฉบับ.wav");
    fs::write(&source, b"preserved source bytes").unwrap();
    let file = root.join("ภาษาไทย.ann");
    let saved = save(
        &file,
        snapshot(),
        BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]),
        &root.join("machine-a"),
    )
    .unwrap();
    fs::remove_file(source).unwrap();
    let opened = open(&file, &root.join("machine-b")).unwrap();
    assert_eq!(saved.snapshot, opened.snapshot);
    assert_eq!(
        opened.snapshot["project"]["variants"][0]["bannerProject"]["layers"][0]["content"]["text"],
        "ตัวแปรที่สอง"
    );
    assert_eq!(
        fs::read(&opened.asset_paths["asset-one"]).unwrap(),
        b"preserved source bytes"
    );
    assert!(!serde_json::to_string(&opened.snapshot)
        .unwrap()
        .contains(root.to_str().unwrap()));
    let candidates = recover(
        "00000000-0000-4000-8000-000000000001",
        &root.join("machine-a"),
    )
    .unwrap();
    assert_eq!(candidates.len(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_asset_and_lock_failure_retain_existing_archive() {
    let root = root();
    let file = root.join("previous.ann");
    fs::write(&file, b"previous document").unwrap();
    assert!(
        save(&file, snapshot(), BTreeMap::new(), &root.join("cache"))
            .unwrap_err()
            .contains("asset-one")
    );
    assert_eq!(fs::read(&file).unwrap(), b"previous document");
    let source = root.join("voice.wav");
    fs::write(&source, b"voice").unwrap();
    let cache = root.join("cache");
    fs::create_dir_all(cache.join("00000000-0000-4000-8000-000000000001")).unwrap();
    let locked = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(cache.join("00000000-0000-4000-8000-000000000001/project.lock"))
        .unwrap();
    locked.try_lock().unwrap();
    assert!(save(
        &file,
        snapshot(),
        BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]),
        &cache
    )
    .unwrap_err()
    .contains("locked"));
    assert_eq!(fs::read(&file).unwrap(), b"previous document");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_traversal_duplicate_corrupt_and_oversized_archives() {
    let root = root();
    for (i, names) in [vec!["../escape"], vec!["project.json", "PROJECT.JSON"]]
        .into_iter()
        .enumerate()
    {
        let path = root.join(format!("unsafe-{i}.ann"));
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for name in names {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"{}").unwrap();
        }
        zip.finish().unwrap();
        assert!(open(&path, &root.join("cache")).is_err());
    }
    let corrupt = root.join("corrupt.ann");
    fs::write(&corrupt, b"not a zip").unwrap();
    assert!(open(&corrupt, &root.join("cache")).is_err());
    let huge = root.join("huge.ann");
    fs::File::create(&huge)
        .unwrap()
        .set_len(MAX_PROJECT + 1)
        .unwrap();
    assert!(open(&huge, &root.join("cache")).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn validates_project_ids_and_relative_asset_references() {
    let root = root();
    let mut bad = snapshot();
    bad["project"]["projectId"] = json!("../escape");
    assert!(prepare(bad, BTreeMap::new(), &root).is_err());
    let mut bad = snapshot();
    bad["project"]["assets"][0]["relativePath"] = json!("../escape");
    assert!(prepare(bad, BTreeMap::new(), &root).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn preparation_keeps_a_recoverable_snapshot_without_touching_the_source() {
    let root = root();
    let source = root.join("source.wav");
    fs::write(&source, b"original bytes").unwrap();
    let mut document = snapshot();
    document["generation"] = json!(12);
    let prepared = prepare(
        document,
        BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]),
        &root.join("cache"),
    )
    .unwrap();
    let latest =
        latest_snapshot("00000000-0000-4000-8000-000000000001", &root.join("cache")).unwrap();
    assert_eq!(latest.unwrap(), prepared.snapshot);
    assert_eq!(fs::read(source).unwrap(), b"original bytes");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn build_commit_retains_a_newer_saved_document_and_adds_historical_result() {
    let root = root();
    let source = root.join("source.wav");
    fs::write(&source, b"voice").unwrap();
    let old = prepare(
        snapshot(),
        BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]),
        &root,
    )
    .unwrap();
    let mut latest = old.snapshot.clone();
    latest["generation"] = json!(5);
    latest["project"]["name"] = json!("newer edits");
    latest["fingerprint"] = json!(project_fingerprint(&latest).unwrap());
    persist_snapshot(&latest, &root).unwrap();
    let history = json!({"revision":3,"digest":"a".repeat(64),"artifactId":"built","projectFingerprint":old.snapshot["fingerprint"],"toolchainFingerprint":"test"});
    assert!(!commit_build_snapshot(&old.snapshot, history, &root).unwrap());
    let result = latest_snapshot("00000000-0000-4000-8000-000000000001", &root)
        .unwrap()
        .unwrap();
    assert_eq!(result["project"]["name"], "newer edits");
    assert_eq!(result["generation"], 5);
    assert_eq!(result["project"]["currentRevision"], 2);
    assert_eq!(
        result["project"]["buildHistory"].as_array().unwrap().len(),
        2
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn preparing_stale_ui_metadata_preserves_committed_revision_and_history() {
    let root = root();
    let source = root.join("source.wav");
    fs::write(&source, b"voice").unwrap();
    let stale = prepare(
        snapshot(),
        BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]),
        &root,
    )
    .unwrap();
    let history = json!({"revision":3,"digest":"a".repeat(64),"artifactId":"built","projectFingerprint":stale.snapshot["fingerprint"],"toolchainFingerprint":"test"});
    assert!(commit_build_snapshot(&stale.snapshot, history, &root).unwrap());
    let result = prepare(stale.snapshot, stale.asset_paths, &root).unwrap();
    assert_eq!(result.snapshot["project"]["currentRevision"], 3);
    assert_eq!(
        result.snapshot["project"]["buildHistory"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    fs::remove_dir_all(root).unwrap();
}
