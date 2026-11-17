fn main() {
    #[cfg(feature = "desktop")]
    {
        // Use one shared compatibility resource for the app and native tests.
        // Layered child input windows require Windows 8+ compatibility.
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
            .expect("build desktop resources");
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        println!("cargo:rerun-if-changed=windows-compatibility.rc");
        if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
            embed_resource::compile_for_everything(
                "windows-compatibility.rc",
                embed_resource::NONE,
            )
            .manifest_required()
            .expect("embed Windows compatibility manifest");
        }
    }
}
