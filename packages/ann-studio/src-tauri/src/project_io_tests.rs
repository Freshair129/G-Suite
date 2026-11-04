use super::*;
use crate::banner_asset_archive;
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

fn editable_banner_archive(root: &Path) -> (PathBuf, String, Vec<u8>) {
    let bytes = b"banner image bytes".to_vec();
    let manifest = json!({
        "format": "g-suite-banner-asset",
        "schemaVersion": 1,
        "assetId": "producer-banner",
        "revision": 3,
        "name": "Verified banner",
        "mediaKind": "editable-template",
        "editableControls": {"title": true, "outerMotion": ["outerOpacity"]},
        "template": {"schemaVersion": 1, "bannerProject": {
            "schemaVersion": 1,
            "id": "producer-project",
            "title": "Producer design",
            "eventId": "first_blood",
            "artboard": {"width": 1280, "height": 720, "safeZonePreset": "dota-hud"},
            "revision": 5,
            "assets": [{"id": "editor-asset-id", "name": "Artwork", "kind": "image", "mime": "image/png", "source": "asset:package-file-id"}],
            "layers": [{"id": "image-layer", "kind": "image", "name": "Artwork", "parentId": null, "order": 0, "visible": true, "locked": false,
                "transform": {"x": 50, "y": 50, "width": 80, "height": 60, "rotation": 0, "opacity": 1}, "style": {}, "content": {"assetId": "editor-asset-id"}}]
        }},
        "files": [{"id": "package-file-id", "path": "assets/artwork.png", "role": "supportingAsset", "mediaType": "image/png", "sizeBytes": bytes.len(), "sha256": g_ann_package::sha256(&bytes)}]
    });
    let path = root.join("banner-asset.zip");
    let mut archive = zip::ZipWriter::new(File::create(&path).unwrap());
    archive
        .start_file("manifest.json", zip::write::SimpleFileOptions::default())
        .unwrap();
    archive
        .write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    archive
        .start_file(
            "assets/artwork.png",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    archive.write_all(&bytes).unwrap();
    archive.finish().unwrap();
    let digest = g_ann_package::sha256(&serde_json::to_vec(&manifest).unwrap());
    (path, digest, bytes)
}

fn runtime_banner_archive(root: &Path, media_kind: &str) -> (PathBuf, String, String) {
    let (path, media_type, role, bytes) = if media_kind == "still-image" {
        (
            "assets/static.webp",
            "image/webp",
            "stillImage",
            b"static image".as_slice(),
        )
    } else {
        (
            "assets/baked.webm",
            "video/webm",
            "runtimeVideo",
            b"silent video".as_slice(),
        )
    };
    let mut manifest = json!({
        "format": "g-suite-banner-asset",
        "schemaVersion": 1,
        "assetId": format!("source-{media_kind}"),
        "revision": 2,
        "name": format!("{media_kind} banner"),
        "mediaKind": media_kind,
        "editableControls": {"title": false, "outerMotion": ["outerOpacity"]},
        "files": [{"id": "runtime-file", "path": path, "role": role, "mediaType": media_type, "sizeBytes": bytes.len(), "sha256": g_ann_package::sha256(bytes)}]
    });
    if media_kind == "baked-video" {
        manifest["silent"] = json!(true);
        manifest["durationMs"] = json!(2500);
    }
    let archive_path = root.join(format!("{media_kind}.zip"));
    let mut archive = zip::ZipWriter::new(File::create(&archive_path).unwrap());
    archive
        .start_file("manifest.json", zip::write::SimpleFileOptions::default())
        .unwrap();
    archive
        .write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    archive
        .start_file(path, zip::write::SimpleFileOptions::default())
        .unwrap();
    archive.write_all(bytes).unwrap();
    archive.finish().unwrap();
    let digest = g_ann_package::sha256(&serde_json::to_vec(&manifest).unwrap());
    (archive_path, digest, format!("source-{media_kind}"))
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
fn applies_verified_banner_to_one_variant_without_changing_voice_or_event_mapping() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let source_paths =
        BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let document = snapshot();
    let before_variant = document["project"]["variants"][0].clone();
    let before_mappings = document["project"]["eventMappings"].clone();
    let (archive, manifest_digest, banner_bytes) = editable_banner_archive(&root);

    let result = import_banner_asset_archive(
        &archive,
        &manifest_digest,
        "second",
        4,
        document.clone(),
        source_paths,
        &workspace,
    )
    .unwrap();

    let project = &result.snapshot["project"];
    let variant = &project["variants"][0];
    assert_eq!(variant["voiceAssetId"], before_variant["voiceAssetId"]);
    assert_eq!(variant["voiceClip"], before_variant["voiceClip"]);
    assert_eq!(variant["bannerId"], before_variant["bannerId"]);
    assert_eq!(variant["sfxCues"], before_variant["sfxCues"]);
    assert_eq!(project["eventMappings"], before_mappings);
    assert_eq!(variant["bannerSource"]["assetId"], "producer-banner");
    assert_eq!(variant["bannerSource"]["revision"], 3);
    assert_eq!(variant["bannerSource"]["manifestSha256"], manifest_digest);
    assert_eq!(variant["bannerProject"]["id"], "producer-project");
    assert_eq!(variant["bannerProject"]["eventId"], "kill");
    assert_eq!(
        variant["bannerProject"]["assets"][0]["id"],
        "editor-asset-id"
    );
    let imported_ref = variant["bannerProject"]["assets"][0]["source"]
        .as_str()
        .unwrap();
    assert_ne!(imported_ref, "asset:package-file-id");
    let managed_id = imported_ref.strip_prefix("asset:").unwrap();
    assert_eq!(
        fs::read(&result.asset_paths[managed_id]).unwrap(),
        banner_bytes
    );
    assert_eq!(project["editor"]["bannerVariantId"], "second");
    assert_eq!(project["editor"]["bannerProject"]["id"], "producer-project");
    assert_eq!(
        fs::read(&result.asset_paths["asset-one"]).unwrap(),
        b"preserved voice"
    );
    assert_eq!(document["project"]["variants"][0], before_variant);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn imports_banner_when_recovery_has_same_generation_baseline() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let baseline = prepare(snapshot(), paths.clone(), &workspace).unwrap();
    let (archive, manifest_digest, _) = editable_banner_archive(&root);

    let imported = import_banner_asset_archive(
        &archive,
        &manifest_digest,
        "second",
        4,
        baseline.snapshot.clone(),
        paths,
        &workspace,
    );

    assert!(
        imported.is_ok(),
        "same-generation recovery baseline should permit banner apply: {imported:?}"
    );
    let imported = imported.unwrap();
    assert_eq!(
        latest_snapshot("00000000-0000-4000-8000-000000000001", &workspace)
            .unwrap()
            .unwrap(),
        imported.snapshot
    );
    assert_eq!(
        imported.snapshot["project"]["variants"][0]["bannerProject"]["eventId"],
        "kill"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn delayed_pre_import_recovery_cannot_replace_imported_banner() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let baseline = prepare(snapshot(), paths.clone(), &workspace).unwrap();
    let (archive, digest, _) = editable_banner_archive(&root);
    let imported = import_banner_asset_archive(
        &archive, &digest, "second", 4, baseline.snapshot.clone(), paths.clone(), &workspace,
    )
    .unwrap();

    // Simulate an earlier prepare request that reaches the lock after the import.
    prepare(baseline.snapshot, paths, &workspace).unwrap();
    let latest = latest_snapshot("00000000-0000-4000-8000-000000000001", &workspace)
        .unwrap()
        .unwrap();
    assert_eq!(latest["project"]["variants"][0]["bannerSource"], imported.snapshot["project"]["variants"][0]["bannerSource"]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_stale_banner_apply_without_replacing_recovery_snapshot() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let mut newer = snapshot();
    newer["generation"] = json!(5);
    let prior = prepare(newer, paths.clone(), &workspace).unwrap();
    let (archive, manifest_digest, _) = editable_banner_archive(&root);
    let mut stale = snapshot();
    stale["generation"] = json!(4);
    let error = import_banner_asset_archive(
        &archive,
        &manifest_digest,
        "second",
        4,
        stale,
        paths,
        &workspace,
    )
    .unwrap_err();
    assert!(error.contains("changed"));
    let latest = latest_snapshot("00000000-0000-4000-8000-000000000001", &workspace)
        .unwrap()
        .unwrap();
    assert_eq!(latest, prior.snapshot);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn imports_still_images_and_silent_video_as_their_real_media_layer_kinds() {
    let root = root();
    for (kind, layer_kind, media_kind) in [
        ("still-image", "image", "image"),
        ("baked-video", "video", "video"),
    ] {
        let source = root.join(format!("voice-{kind}.wav"));
        fs::write(&source, b"voice").unwrap();
        let workspace = root.join(format!("cache-{kind}"));
        let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
        let (archive, digest, source_id) = runtime_banner_archive(&root, kind);
        let imported = import_banner_asset_archive(
            &archive,
            &digest,
            "second",
            4,
            snapshot(),
            paths,
            &workspace,
        )
        .unwrap();
        let banner = &imported.snapshot["project"]["variants"][0]["bannerProject"];
        assert_eq!(banner["assets"][0]["kind"], media_kind);
        assert_eq!(banner["layers"][0]["kind"], layer_kind);
        assert_eq!(banner["eventId"], "kill");
        assert!(banner["assets"][0]["source"]
            .as_str()
            .unwrap()
            .starts_with("asset:banner-"));
        assert_eq!(
            imported.snapshot["project"]["variants"][0]["bannerSource"]["assetId"],
            source_id
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "run through tools/test-banner-roundtrip.ps1 with a Studio-produced ZIP"]
fn imports_studio_producer_archive_and_reopens_the_saved_project() {
    let archive = PathBuf::from(
        std::env::var_os("G_SUITE_BANNER_E2E_ARCHIVE")
            .expect("round-trip runner must provide the producer archive"),
    );
    let root = root();
    let voice = root.join("voice.wav");
    fs::write(&voice, b"preserved AnnStudio voice bytes").unwrap();
    let workspace = root.join("app-data");
    let source_paths = BTreeMap::from([("asset-one".into(), voice.to_string_lossy().into_owned())]);
    let original = snapshot();
    let original_variant = original["project"]["variants"][0].clone();
    let original_mappings = original["project"]["eventMappings"].clone();
    let preview = banner_asset_archive::inspect(&archive).unwrap();
    assert_eq!(preview.manifest["mediaKind"], "still-image");

    let imported = import_banner_asset_archive(
        &archive,
        &preview.manifest_sha256,
        "second",
        4,
        original,
        source_paths,
        &workspace,
    )
    .unwrap();
    let project = &imported.snapshot["project"];
    let variant = &project["variants"][0];
    assert_eq!(variant["voiceClip"], original_variant["voiceClip"]);
    assert_eq!(variant["voiceAssetId"], original_variant["voiceAssetId"]);
    assert_eq!(variant["bannerId"], original_variant["bannerId"]);
    assert_eq!(variant["sfxCues"], original_variant["sfxCues"]);
    assert_eq!(project["eventMappings"], original_mappings);
    assert_eq!(
        variant["bannerSource"]["assetId"],
        preview.manifest["assetId"]
    );
    assert_eq!(
        variant["bannerSource"]["revision"],
        preview.manifest["revision"]
    );
    assert_eq!(
        variant["bannerSource"]["manifestSha256"],
        preview.manifest_sha256
    );
    assert_eq!(variant["bannerProject"]["eventId"], "kill");
    assert_eq!(variant["bannerProject"]["assets"][0]["kind"], "image");
    let managed_id = variant["bannerProject"]["assets"][0]["source"]
        .as_str()
        .unwrap()
        .strip_prefix("asset:")
        .unwrap()
        .to_owned();
    let imported_image = fs::read(imported.asset_paths.get(&managed_id).unwrap()).unwrap();
    assert_eq!(
        imported_image.len() as u64,
        preview.manifest["files"][0]["sizeBytes"].as_u64().unwrap()
    );
    assert_eq!(
        g_ann_package::sha256(&imported_image),
        preview.manifest["files"][0]["sha256"].as_str().unwrap()
    );

    let project_file = root.join("round-trip.ann");
    let saved = save(
        &project_file,
        imported.snapshot,
        imported.asset_paths,
        &workspace,
    )
    .unwrap();
    let reopened = open(&project_file, &workspace).unwrap();
    assert_eq!(reopened.snapshot, saved.snapshot);
    assert_eq!(
        reopened.snapshot["project"]["eventMappings"],
        original_mappings
    );
    assert_eq!(
        reopened.snapshot["project"]["variants"][0]["voiceClip"],
        original_variant["voiceClip"]
    );
    assert_eq!(
        fs::read(reopened.asset_paths.get(&managed_id).unwrap()).unwrap(),
        imported_image
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn banner_import_lock_and_managed_asset_copy_failures_retain_the_previous_recovery() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let prior = prepare(snapshot(), paths.clone(), &workspace).unwrap();
    let (archive, digest, banner_bytes) = editable_banner_archive(&root);
    let lock = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(workspace.join("00000000-0000-4000-8000-000000000001/project.lock"))
        .unwrap();
    lock.try_lock().unwrap();
    assert!(import_banner_asset_archive(
        &archive,
        &digest,
        "second",
        4,
        prior.snapshot.clone(),
        paths.clone(),
        &workspace,
    )
    .unwrap_err()
    .contains("locked"));
    drop(lock);

    let hash = g_ann_package::sha256(&banner_bytes);
    fs::create_dir_all(
        workspace
            .join("00000000-0000-4000-8000-000000000001/assets")
            .join(format!("{hash}.png")),
    )
    .unwrap();
    assert!(import_banner_asset_archive(
        &archive,
        &digest,
        "second",
        4,
        prior.snapshot.clone(),
        paths,
        &workspace,
    )
    .is_err());
    let latest = latest_snapshot("00000000-0000-4000-8000-000000000001", &workspace)
        .unwrap()
        .unwrap();
    assert_eq!(latest, prior.snapshot);
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
