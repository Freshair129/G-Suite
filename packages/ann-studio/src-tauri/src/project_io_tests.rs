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

fn current_session_token(workspace: &Path) -> String {
    latest_snapshot("00000000-0000-4000-8000-000000000001", workspace)
        .unwrap()
        .and_then(|snapshot| active_session_token(&snapshot).map(str::to_owned))
        .expect("active project session")
}

fn without_session_token(mut snapshot: Value) -> Value {
    if let Some(object) = snapshot.as_object_mut() {
        object.remove("sessionToken");
    }
    snapshot
}

fn editable_banner_archive(root: &Path) -> (PathBuf, String, Vec<u8>) {
    let bytes = include_bytes!("../icons/32x32.png").to_vec();
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
            include_bytes!("../../src/public/dota-hud-reference.webp").as_slice(),
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
    assert_eq!(candidates.candidates.len(), 1);
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
    let baseline = prepare(document.clone(), source_paths, &workspace).unwrap();

    let result = import_banner_asset_archive(
        &archive,
        &manifest_digest,
        "second",
        4,
        baseline.snapshot,
        baseline.asset_paths,
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
    let latest = latest_snapshot("00000000-0000-4000-8000-000000000001", &workspace)
        .unwrap()
        .unwrap();
    assert_eq!(
        latest["sessionToken"].as_str(),
        imported.session_token.as_deref()
    );
    assert_eq!(without_session_token(latest), imported.snapshot);
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
        &archive,
        &digest,
        "second",
        4,
        baseline.snapshot.clone(),
        paths.clone(),
        &workspace,
    )
    .unwrap();

    assert_eq!(imported.snapshot["generation"], 5);
    // Simulate an earlier prepare request that reaches the lock after the import.
    let stale_prepare = prepare(baseline.snapshot, paths, &workspace).unwrap_err();
    assert!(stale_prepare.contains("changed while the save was pending"));
    let latest = latest_snapshot("00000000-0000-4000-8000-000000000001", &workspace)
        .unwrap()
        .unwrap();
    assert_eq!(
        latest["project"]["variants"][0]["bannerSource"],
        imported.snapshot["project"]["variants"][0]["bannerSource"]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn delayed_pre_import_save_does_not_replace_newer_archive() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let baseline = prepare(snapshot(), paths.clone(), &workspace).unwrap();
    let (archive, digest, _) = editable_banner_archive(&root);
    let imported = import_banner_asset_archive(
        &archive,
        &digest,
        "second",
        4,
        baseline.snapshot.clone(),
        paths.clone(),
        &workspace,
    )
    .unwrap();
    let destination = root.join("project.ann");
    save(
        &destination,
        imported.snapshot.clone(),
        imported.asset_paths,
        &workspace,
    )
    .unwrap();
    let before = fs::read(&destination).unwrap();

    assert!(save(&destination, baseline.snapshot, paths, &workspace).is_err());
    assert_eq!(fs::read(&destination).unwrap(), before);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reopening_an_older_archive_can_save_a_copy_without_erasing_newer_recovery() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let destination = root.join("original.ann");
    save(&destination, snapshot(), paths.clone(), &workspace).unwrap();
    let mut newer = snapshot();
    newer["generation"] = json!(5);
    newer["project"]["name"] = json!("Newer recovery");
    newer["generation"] = json!(6);
    let token = current_session_token(&workspace);
    let recovery = prepare_with_session(newer, paths, Some(token.clone()), &workspace).unwrap();

    let opened = open(&destination, &workspace).unwrap();
    let activated =
        activate_project_session(opened.snapshot, opened.asset_paths, Some(token), &workspace)
            .unwrap();
    let active_token = activated.session_token.clone().unwrap();
    let copy = root.join("copy.ann");
    save_with_session(
        &copy,
        activated.snapshot.clone(),
        activated.asset_paths.clone(),
        &active_token,
        &workspace,
    )
    .unwrap();
    assert!(copy.is_file());
    save_with_session(
        &destination,
        activated.snapshot,
        activated.asset_paths,
        &active_token,
        &workspace,
    )
    .unwrap();
    let listing = recover("00000000-0000-4000-8000-000000000001", &workspace).unwrap();
    let retained = listing
        .candidates
        .iter()
        .find(|candidate| candidate.kind == "history")
        .expect("newer recovery remains in history");
    assert_eq!(
        open_recovery_candidate(
            "00000000-0000-4000-8000-000000000001",
            &retained.id,
            &workspace,
        )
        .unwrap()
        .snapshot["project"]["name"],
        recovery.snapshot["project"]["name"]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn different_projects_cannot_replace_a_shared_destination_without_matching_confirmation() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let destination = root.join("shared.ann");
    let first = save(&destination, snapshot(), paths.clone(), &workspace).unwrap();

    let mut second_snapshot = snapshot();
    second_snapshot["project"]["projectId"] = json!("00000000-0000-4000-8000-000000000006");
    second_snapshot["project"]["announcerId"] = json!("ann_00000000-0000-4000-8000-000000000007");
    second_snapshot["fingerprint"] = json!(project_fingerprint(&second_snapshot).unwrap());
    let second = activate_project_session(second_snapshot, paths, None, &workspace).unwrap();
    let second_token = second.session_token.clone().unwrap();

    let conflict = save_with_session_confirmed_destination(
        &destination,
        second.snapshot.clone(),
        second.asset_paths.clone(),
        &second_token,
        None,
        &workspace,
    )
    .unwrap_err();
    let first_confirmation = conflict
        .strip_prefix(DESTINATION_CONFLICT_PREFIX)
        .expect("a different project requires explicit overwrite confirmation");
    assert_eq!(
        first_confirmation,
        destination_digest(&destination).unwrap()
    );
    assert_eq!(
        open(&destination, &workspace).unwrap().snapshot["project"]["projectId"],
        first.snapshot["project"]["projectId"]
    );

    fs::write(
        &destination,
        b"changed while the confirmation dialog was open",
    )
    .unwrap();
    let changed_bytes = fs::read(&destination).unwrap();
    let changed_conflict = save_with_session_confirmed_destination(
        &destination,
        second.snapshot.clone(),
        second.asset_paths.clone(),
        &second_token,
        Some(first_confirmation),
        &workspace,
    )
    .unwrap_err();
    let second_confirmation = changed_conflict
        .strip_prefix(DESTINATION_CONFLICT_PREFIX)
        .expect("a changed destination requires a fresh confirmation");
    assert_ne!(first_confirmation, second_confirmation);
    assert_eq!(fs::read(&destination).unwrap(), changed_bytes);

    save_with_session_confirmed_destination(
        &destination,
        second.snapshot,
        second.asset_paths,
        &second_token,
        Some(second_confirmation),
        &workspace,
    )
    .unwrap();
    assert_eq!(
        open(&destination, &workspace).unwrap().snapshot["project"]["projectId"],
        "00000000-0000-4000-8000-000000000006"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn damaged_same_project_destination_requires_overwrite_confirmation() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let destination = root.join("project.ann");
    let saved = save(&destination, snapshot(), paths, &workspace).unwrap();

    let mut original = zip::ZipArchive::new(File::open(&destination).unwrap()).unwrap();
    let mut document = Vec::new();
    original
        .by_name("project.json")
        .unwrap()
        .read_to_end(&mut document)
        .unwrap();
    let asset_name = saved.snapshot["project"]["assets"][0]["relativePath"]
        .as_str()
        .unwrap()
        .to_owned();
    let incomplete = root.join("incomplete.ann");
    let mut damaged = zip::ZipWriter::new(File::create(&incomplete).unwrap());
    damaged
        .start_file("project.json", zip::write::SimpleFileOptions::default())
        .unwrap();
    damaged.write_all(&document).unwrap();
    damaged
        .start_file(&asset_name, zip::write::SimpleFileOptions::default())
        .unwrap();
    damaged.write_all(b"corrupt asset bytes").unwrap();
    damaged.finish().unwrap();
    fs::remove_file(&destination).unwrap();
    fs::rename(&incomplete, &destination).unwrap();
    let damaged_bytes = fs::read(&destination).unwrap();

    let conflict = save_with_session_confirmed_destination(
        &destination,
        saved.snapshot,
        saved.asset_paths,
        &saved.session_token,
        None,
        &workspace,
    )
    .unwrap_err();

    assert!(conflict.starts_with(DESTINATION_CONFLICT_PREFIX));
    assert_eq!(fs::read(&destination).unwrap(), damaged_bytes);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn destination_lock_serializes_saves_for_a_canonical_destination_path() {
    let root = root();
    let workspace = root.join("cache");
    let destination = root.join("shared.ann");
    let held = destination_lock(&destination, &workspace).unwrap();
    assert!(destination_lock(&destination, &workspace).is_err());
    drop(held);
    let released = destination_lock(&destination, &workspace).unwrap();
    drop(released);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn edits_after_opening_older_archive_do_not_replace_newer_recovery() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let destination = root.join("original.ann");
    save(&destination, snapshot(), paths.clone(), &workspace).unwrap();
    let token = current_session_token(&workspace);
    let mut newer = snapshot();
    newer["generation"] = json!(6);
    newer["project"]["name"] = json!("Newer recovery");
    let recovery = prepare_with_session(newer, paths, Some(token.clone()), &workspace).unwrap();

    let opened = open(&destination, &workspace).unwrap();
    let activated =
        activate_project_session(opened.snapshot, opened.asset_paths, Some(token), &workspace)
            .unwrap();
    let active_token = activated.session_token.unwrap();
    let mut edited = activated.snapshot;
    let next_generation = edited["generation"].as_u64().unwrap() + 1;
    edited["generation"] = json!(next_generation);
    edited["project"]["name"] = json!("Edits from older archive");
    prepare_with_session(
        edited,
        activated.asset_paths,
        Some(active_token),
        &workspace,
    )
    .unwrap();
    let listing = recover("00000000-0000-4000-8000-000000000001", &workspace).unwrap();
    let retained = listing
        .candidates
        .iter()
        .find(|candidate| {
            candidate.kind == "history"
                && candidate.fingerprint == project_fingerprint(&recovery.snapshot).unwrap()
        })
        .expect("newer recovery remains accessible after editing the older archive");
    assert_eq!(
        open_recovery_candidate(
            "00000000-0000-4000-8000-000000000001",
            &retained.id,
            &workspace,
        )
        .unwrap()
        .snapshot["project"]["name"],
        "Newer recovery"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovery_history_is_listed_without_materializing_archives_when_active_is_missing() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let prepared = prepare(snapshot(), paths, &workspace).unwrap();
    let project_root = workspace.join("00000000-0000-4000-8000-000000000001");
    let history = project_root.join("recovery-history");
    fs::create_dir_all(&history).unwrap();
    let bytes = serde_json::to_vec(&prepared.snapshot).unwrap();
    fs::write(
        history.join(format!("{}.json", g_ann_package::sha256(&bytes))),
        bytes,
    )
    .unwrap();
    fs::remove_file(project_root.join("recovery.json")).unwrap();

    let candidates = recover("00000000-0000-4000-8000-000000000001", &workspace).unwrap();
    assert_eq!(candidates.candidates.len(), 1);
    assert_eq!(candidates.candidates[0].kind, "history");
    assert_eq!(
        candidates.candidates[0].id,
        g_ann_package::sha256(&serde_json::to_vec(&prepared.snapshot).unwrap())
    );
    assert!(fs::read_dir(&history).unwrap().all(|entry| entry
        .unwrap()
        .path()
        .extension()
        .unwrap()
        == "json"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn truncated_recovery_listing_selects_a_stable_sorted_candidate_subset() {
    let root = root();
    let workspace = root.join("cache");
    let history = workspace
        .join("00000000-0000-4000-8000-000000000001")
        .join("recovery-history");
    fs::create_dir_all(&history).unwrap();
    let mut expected = Vec::new();
    for index in 0..=MAX_RECOVERY_CANDIDATES {
        let mut candidate = snapshot();
        candidate["generation"] = json!(index as u64 + 1);
        candidate["project"]["name"] = json!(format!("Recovery {index:03}"));
        candidate["fingerprint"] = json!(project_fingerprint(&candidate).unwrap());
        let bytes = serde_json::to_vec(&candidate).unwrap();
        let digest = g_ann_package::sha256(&bytes);
        fs::write(history.join(format!("{digest}.json")), bytes).unwrap();
        expected.push(digest);
    }
    expected.sort();
    expected.truncate(MAX_RECOVERY_CANDIDATES);

    let first = recover("00000000-0000-4000-8000-000000000001", &workspace).unwrap();
    let second = recover("00000000-0000-4000-8000-000000000001", &workspace).unwrap();
    assert!(first.truncated);
    assert!(second.truncated);
    assert_eq!(
        first
            .candidates
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect::<BTreeSet<_>>(),
        expected.into_iter().collect::<BTreeSet<_>>()
    );
    assert_eq!(
        first
            .candidates
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect::<BTreeSet<_>>(),
        second
            .candidates
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect::<BTreeSet<_>>()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn selected_history_opens_when_active_recovery_is_unreadable() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let prepared = prepare(snapshot(), paths, &workspace).unwrap();
    let project_root = workspace.join("00000000-0000-4000-8000-000000000001");
    let history = project_root.join("recovery-history");
    fs::create_dir_all(&history).unwrap();
    let bytes = serde_json::to_vec(&prepared.snapshot).unwrap();
    let digest = g_ann_package::sha256(&bytes);
    fs::write(history.join(format!("{digest}.json")), bytes).unwrap();

    let active = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(project_root.join("recovery.json"))
        .unwrap();
    active.set_len(MAX_DOCUMENT + 1).unwrap();
    drop(active);

    let listing = recover("00000000-0000-4000-8000-000000000001", &workspace).unwrap();
    assert!(listing
        .warnings
        .iter()
        .any(|warning| warning.message.contains("Invalid file or size")));
    assert!(listing
        .candidates
        .iter()
        .any(|candidate| candidate.id == digest));
    let opened =
        open_recovery_candidate("00000000-0000-4000-8000-000000000001", &digest, &workspace)
            .unwrap();
    assert_eq!(
        opened.snapshot["project"]["name"],
        prepared.snapshot["project"]["name"]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn retained_recovery_document_opens_with_managed_assets() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let prepared = prepare(snapshot(), paths, &workspace).unwrap();
    let history = workspace
        .join("00000000-0000-4000-8000-000000000001")
        .join("recovery-history");
    fs::create_dir_all(&history).unwrap();
    let bytes = serde_json::to_vec(&prepared.snapshot).unwrap();
    let digest = g_ann_package::sha256(&bytes);
    let path = history.join(format!("{digest}.json"));
    fs::write(&path, bytes).unwrap();
    let opened =
        open_retained_candidate("00000000-0000-4000-8000-000000000001", &digest, &workspace)
            .unwrap();
    assert_eq!(opened.snapshot, prepared.snapshot);
    assert_eq!(
        fs::read(&opened.asset_paths["asset-one"]).unwrap(),
        b"preserved voice"
    );
    fs::write(&opened.asset_paths["asset-one"], b"damaged voice").unwrap();
    assert!(
        open_retained_candidate("00000000-0000-4000-8000-000000000001", &digest, &workspace,)
            .is_err()
    );
    fs::write(&opened.asset_paths["asset-one"], b"preserved voice").unwrap();
    fs::remove_file(&opened.asset_paths["asset-one"]).unwrap();
    assert!(
        open_retained_candidate("00000000-0000-4000-8000-000000000001", &digest, &workspace,)
            .is_err()
    );
    let project_root = workspace.join("00000000-0000-4000-8000-000000000001");
    drop(lock(&project_root).unwrap());
    fs::write(&opened.asset_paths["asset-one"], b"preserved voice").unwrap();
    assert!(open_retained_candidate(
        "00000000-0000-4000-8000-000000000001",
        "../escape",
        &workspace,
    )
    .is_err());
    fs::write(&path, b"damaged").unwrap();
    assert!(
        open_retained_candidate("00000000-0000-4000-8000-000000000001", &digest, &workspace,)
            .is_err()
    );
    assert_eq!(fs::read(&path).unwrap(), b"damaged");
    let mut aliased = prepared.snapshot.clone();
    let mut second = aliased["project"]["assets"][0].clone();
    second["id"] = json!("asset-two");
    aliased["project"]["assets"]
        .as_array_mut()
        .unwrap()
        .push(second);
    aliased["fingerprint"] = json!(project_fingerprint(&aliased).unwrap());
    let bytes = serde_json::to_vec(&aliased).unwrap();
    let alias_digest = g_ann_package::sha256(&bytes);
    fs::write(history.join(format!("{alias_digest}.json")), bytes).unwrap();
    let reopened = open_retained_candidate(
        "00000000-0000-4000-8000-000000000001",
        &alias_digest,
        &workspace,
    )
    .unwrap();
    assert_eq!(
        reopened.asset_paths["asset-one"],
        reopened.asset_paths["asset-two"]
    );
    aliased["project"]["assets"][1]["sha256"] = json!("a".repeat(64));
    aliased["fingerprint"] = json!(project_fingerprint(&aliased).unwrap());
    let bytes = serde_json::to_vec(&aliased).unwrap();
    let conflict_digest = g_ann_package::sha256(&bytes);
    fs::write(history.join(format!("{conflict_digest}.json")), bytes).unwrap();
    assert!(open_retained_candidate(
        "00000000-0000-4000-8000-000000000001",
        &conflict_digest,
        &workspace,
    )
    .is_err());
    aliased["project"]["assets"][1] = aliased["project"]["assets"][0].clone();
    aliased["project"]["assets"][1]["id"] = json!("asset-two");
    let original = aliased["project"]["assets"][0]["relativePath"]
        .as_str()
        .unwrap()
        .to_owned();
    aliased["project"]["assets"][1]["relativePath"] = json!(original.replace(".wav", ".WAV"));
    aliased["fingerprint"] = json!(project_fingerprint(&aliased).unwrap());
    let bytes = serde_json::to_vec(&aliased).unwrap();
    let case_digest = g_ann_package::sha256(&bytes);
    fs::write(history.join(format!("{case_digest}.json")), bytes).unwrap();
    assert!(open_retained_candidate(
        "00000000-0000-4000-8000-000000000001",
        &case_digest,
        &workspace,
    )
    .is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn previous_session_cannot_save_after_same_archive_is_reopened_and_saved() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let destination = root.join("project.ann");
    save(&destination, snapshot(), paths, &workspace).unwrap();

    let previous = open(&destination, &workspace).unwrap();
    let current = open(&destination, &workspace).unwrap();
    let previous_token = current_session_token(&workspace);
    let activated = activate_project_session(
        current.snapshot,
        current.asset_paths,
        Some(previous_token.clone()),
        &workspace,
    )
    .unwrap();
    let current_token = activated.session_token.unwrap();
    save_with_session(
        &destination,
        activated.snapshot,
        activated.asset_paths,
        &current_token,
        &workspace,
    )
    .unwrap();
    let before = fs::read(&destination).unwrap();
    assert!(save_with_session(
        &destination,
        previous.snapshot,
        previous.asset_paths,
        &previous_token,
        &workspace
    )
    .is_err());
    assert_eq!(fs::read(&destination).unwrap(), before);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn superseded_session_cannot_prepare_or_replace_the_active_recovery() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let destination = root.join("project.ann");
    save(&destination, snapshot(), paths, &workspace).unwrap();
    let previous_token = current_session_token(&workspace);
    let previous = open(&destination, &workspace).unwrap();
    let current = activate_project_session(
        previous.snapshot.clone(),
        previous.asset_paths.clone(),
        Some(previous_token.clone()),
        &workspace,
    )
    .unwrap();
    let before =
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap();
    let mut stale = previous.snapshot;
    stale["generation"] = json!(stale["generation"].as_u64().unwrap() + 1);
    stale["project"]["name"] = json!("stale session edit");
    assert!(prepare_with_session(
        stale,
        previous.asset_paths,
        Some(previous_token),
        &workspace,
    )
    .is_err());
    assert_eq!(
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap(),
        before
    );
    assert_ne!(current.session_token, None);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn stale_session_cannot_recreate_missing_active_recovery() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let prepared = prepare(snapshot(), paths.clone(), &workspace).unwrap();
    let stale_token = current_session_token(&workspace);
    let recovery = workspace.join("00000000-0000-4000-8000-000000000001/recovery.json");
    fs::remove_file(&recovery).unwrap();
    assert!(
        prepare_with_session(prepared.snapshot, paths, Some(stale_token), &workspace,).is_err()
    );
    assert!(
        !recovery.exists(),
        "stale writer must not bootstrap a deleted session"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn superseded_session_cannot_import_banner_assets_or_replace_recovery() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let destination = root.join("project.ann");
    save(&destination, snapshot(), paths, &workspace).unwrap();
    let stale_token = current_session_token(&workspace);
    let opened = open(&destination, &workspace).unwrap();
    let activated = activate_project_session(
        opened.snapshot,
        opened.asset_paths,
        Some(stale_token.clone()),
        &workspace,
    )
    .unwrap();
    let before =
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap();
    let (archive, manifest_digest, _) = editable_banner_archive(&root);
    assert!(import_banner_asset_archive_with_session(
        &archive,
        &manifest_digest,
        "second",
        activated.snapshot["generation"].as_u64().unwrap(),
        &stale_token,
        activated.snapshot,
        activated.asset_paths,
        &workspace,
    )
    .is_err());
    assert_eq!(
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap(),
        before
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn superseded_build_completion_cannot_replace_active_recovery() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let first = prepare(snapshot(), paths, &workspace).unwrap();
    let stale_token = current_session_token(&workspace);
    let activated = activate_project_session(
        first.snapshot.clone(),
        first.asset_paths.clone(),
        Some(stale_token.clone()),
        &workspace,
    )
    .unwrap();
    let before =
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap();
    let result = commit_build_snapshot_with_session(
        &first.snapshot,
        &stale_token,
        json!({"revision":3,"digest":"stale-build"}),
        &workspace,
    )
    .unwrap();
    assert!(!result, "stale build completion is reported as superseded");
    assert_eq!(
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap(),
        before
    );
    assert_ne!(
        activated.session_token.as_deref(),
        Some(stale_token.as_str())
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_activation_keeps_the_previous_recovery_unchanged() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let destination = root.join("project.ann");
    save(&destination, snapshot(), paths, &workspace).unwrap();
    let before =
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap();
    let opened = open(&destination, &workspace).unwrap();
    assert!(activate_project_session(
        opened.snapshot,
        opened.asset_paths,
        Some("f".repeat(64)),
        &workspace,
    )
    .is_err());
    assert_eq!(
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap(),
        before
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn activation_rejects_announcer_identity_changes_within_a_project_lineage() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let prepared = prepare(snapshot(), paths, &workspace).unwrap();
    let token = current_session_token(&workspace);
    let before =
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap();
    let mut changed = prepared.snapshot;
    changed["project"]["announcerId"] = json!("ann_00000000-0000-4000-8000-000000000010");
    assert!(
        activate_project_session(changed, prepared.asset_paths, Some(token), &workspace,).is_err()
    );
    assert_eq!(
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap(),
        before
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn activation_rejects_generation_overflow_without_changing_recovery() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let destination = root.join("project.ann");
    save(&destination, snapshot(), paths, &workspace).unwrap();
    let token = current_session_token(&workspace);
    let mut highest = latest_snapshot("00000000-0000-4000-8000-000000000001", &workspace)
        .unwrap()
        .unwrap();
    highest["generation"] = json!(MAX_SAFE_GENERATION);
    persist_session_locked(
        &highest,
        &token,
        &workspace.join("00000000-0000-4000-8000-000000000001"),
    )
    .unwrap();
    let before =
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap();
    let opened = open(&destination, &workspace).unwrap();
    assert!(
        activate_project_session(opened.snapshot, opened.asset_paths, Some(token), &workspace,)
            .is_err()
    );
    assert_eq!(
        fs::read(workspace.join("00000000-0000-4000-8000-000000000001/recovery.json")).unwrap(),
        before
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn snapshots_above_the_javascript_safe_generation_limit_are_rejected() {
    let mut invalid = snapshot();
    invalid["generation"] = json!(MAX_SAFE_GENERATION + 1);
    assert!(validate(&invalid)
        .unwrap_err()
        .contains("safe-integer limit"));
}

#[test]
fn same_generation_divergence_is_retained_and_corrupt_entries_do_not_hide_it() {
    let root = root();
    let source = root.join("voice.wav");
    fs::write(&source, b"preserved voice").unwrap();
    let workspace = root.join("cache");
    let paths = BTreeMap::from([("asset-one".into(), source.to_string_lossy().into_owned())]);
    let first = prepare(snapshot(), paths.clone(), &workspace).unwrap();
    let mut divergent = first.snapshot.clone();
    divergent["project"]["name"] = json!("same generation, different content");
    divergent["fingerprint"] = json!(project_fingerprint(&divergent).unwrap());
    persist_snapshot(&divergent, &workspace).unwrap();
    let history = workspace
        .join("00000000-0000-4000-8000-000000000001")
        .join("recovery-history");
    fs::write(
        history.join(format!("{}.json", "a".repeat(64))),
        b"corrupt recovery",
    )
    .unwrap();
    let listing = recover("00000000-0000-4000-8000-000000000001", &workspace).unwrap();
    assert!(listing.candidates.len() >= 2);
    let corrupt_id = "a".repeat(64);
    assert!(listing
        .warnings
        .iter()
        .any(|warning| warning.id.as_deref() == Some(corrupt_id.as_str())));
    let names = listing
        .candidates
        .iter()
        .map(|candidate| {
            open_recovery_candidate(
                "00000000-0000-4000-8000-000000000001",
                &candidate.id,
                &workspace,
            )
            .unwrap()
            .snapshot["project"]["name"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect::<Vec<_>>();
    assert!(names.contains(
        &first.snapshot["project"]["name"]
            .as_str()
            .unwrap()
            .to_owned()
    ));
    assert!(names.contains(&"same generation, different content".to_owned()));
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
    assert_eq!(
        latest["sessionToken"].as_str(),
        prior.session_token.as_deref()
    );
    assert_eq!(without_session_token(latest), prior.snapshot);
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
        let baseline = prepare(snapshot(), paths, &workspace).unwrap();
        let imported = import_banner_asset_archive(
            &archive,
            &digest,
            "second",
            4,
            baseline.snapshot,
            baseline.asset_paths,
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
    let baseline = prepare(original.clone(), source_paths, &workspace).unwrap();
    let preview = banner_asset_archive::inspect(&archive).unwrap();
    assert_eq!(preview.manifest["mediaKind"], "still-image");

    let imported = import_banner_asset_archive(
        &archive,
        &preview.manifest_sha256,
        "second",
        4,
        baseline.snapshot,
        baseline.asset_paths,
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
    assert_eq!(
        latest["sessionToken"].as_str(),
        prior.session_token.as_deref()
    );
    assert_eq!(without_session_token(latest), prior.snapshot);
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
    let latest = latest.unwrap();
    assert_eq!(
        latest["sessionToken"].as_str(),
        prepared.session_token.as_deref()
    );
    assert_eq!(without_session_token(latest), prepared.snapshot);
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
