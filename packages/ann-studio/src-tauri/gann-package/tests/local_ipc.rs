use g_ann_package::local_ipc::*;
use serde_json::json;

#[test]
fn profile_nonce_and_protocol_are_bound_before_install() {
    let expected = Handshake::new("test-profile".into(), "a".repeat(64));
    assert!(expected.validate(&expected).is_ok());
    for bad in [Handshake { protocol_version: 2, ..expected.clone() },
                Handshake { profile_id: "other".into(), ..expected.clone() },
                Handshake { nonce: "b".repeat(64), ..expected.clone() }] {
        assert!(expected.validate(&bad).is_err());
    }
}

#[test]
fn frames_are_bounded_and_reject_unknown_authority() {
    assert!(decode_frame(&vec![b'x'; MAX_FRAME + 1]).is_err());
    let request = json!({"protocol_version":1,"request_id":"request1","profile_id":"test-profile",
        "source_path":"C:/แพ็ก/เสียง.gann","expected_digest":"a".repeat(64),"project_binding":null,"equip_policy":"never"});
    assert!(serde_json::from_value::<LocalInstall>(request.clone()).unwrap().validate().is_ok());
    let mut forged = request;
    forged["authority"] = "store".into();
    assert!(serde_json::from_value::<LocalInstall>(forged).is_err());
}

#[test]
fn explicit_profile_selection_never_chooses_a_different_registration() {
    assert!(select_registration(&[], "missing").is_err());
}

#[cfg(windows)]
#[test]
fn native_two_profiles_bind_server_identity_and_reject_other_user_registration() {
    use g_ann_package::local_ipc::windows::*;
    let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    runtime.block_on(async {
        let root=std::env::temp_dir().join(format!("gann-pipe-{}",random_nonce().unwrap()));
        std::fs::create_dir(&root).unwrap();
        let a=new_registration("profile-a".into(),"A".into(),"test".into(),root.clone()).unwrap();
        let b=new_registration("profile-b".into(),"B".into(),"test".into(),root.clone()).unwrap();
        let mut foreign=a.clone(); foreign.owner_sid="S-1-5-21-0-0-0-98765".into();
        assert!(serve(foreign,root.clone(),std::sync::Arc::new(|v|v)).await.is_err());
        let host_a=tokio::spawn(serve(a.clone(),root.clone(),std::sync::Arc::new(|_|json!({"profile":"a"}))));
        let host_b=tokio::spawn(serve(b.clone(),root.clone(),std::sync::Arc::new(|_|json!({"profile":"b"}))));
        for _ in 0..100 { if root.join("profile-a.json").exists() && root.join("profile-b.json").exists(){break} tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
        assert_eq!(request(&a,json!({})).await.unwrap()["profile"],"a");
        assert_eq!(request(&b,json!({})).await.unwrap()["profile"],"b");
        let mut swapped=a.clone(); swapped.endpoint=b.endpoint.clone();
        assert!(request(&swapped,json!({})).await.is_err());
        let mut wrong_pid=a.clone(); wrong_pid.process_id=0;
        assert!(request(&wrong_pid,json!({})).await.is_err());
        host_a.abort();host_b.abort();
        let _=host_a.await;let _=host_b.await;
        std::fs::remove_dir_all(root).unwrap();
    });
}
