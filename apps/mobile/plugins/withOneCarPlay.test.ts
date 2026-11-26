import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AndroidConfig, compileModsAsync, XML } from "expo/config-plugins";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import withOneCarPlay from "./withOneCarPlay.cjs";

const ANDROID_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <application android:name=".MainApplication" />
</manifest>`;

const projectRoots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of projectRoots.splice(0)) {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

describe("withOneCarPlay", () => {
  it("adds CarPlay CPTemplateApplicationScene configuration and background audio idempotently", () => {
    const initial = {
      UIBackgroundModes: ["remote-notification"],
      UIApplicationSceneManifest: {
        UISceneConfigurations: {
          UIWindowSceneSessionRoleApplication: [
            {
              UISceneConfigurationName: "Default Configuration",
              UISceneDelegateClassName: "SceneDelegate",
            },
          ],
        },
      },
    };

    const once = withOneCarPlay.applyCarPlayInfoPlist(initial, "none");
    const twice = withOneCarPlay.applyCarPlayInfoPlist(once, "none");

    expect(once).toEqual(twice);
    expect(once.UIBackgroundModes).toEqual(["remote-notification", "audio"]);
    expect(once.OneCarPlayEntitlementExpected).toBe(false);
    expect(once.OneCarPlayEntitlementMode).toBe("none");
    expect(once.UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes).toBe(true);
    expect(
      once.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication,
    ).toEqual(
      initial.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication,
    );
    expect(
      once.UIApplicationSceneManifest.UISceneConfigurations[withOneCarPlay.CARPLAY_SCENE_ROLE],
    ).toEqual([withOneCarPlay.CARPLAY_SCENE_CONFIG]);
  });

  it("omits CarPlay entitlements by default so local and Personal Team Xcode signing never breaks", () => {
    vi.stubEnv("ONE_CARPLAY_ENTITLEMENT", undefined);
    vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", undefined);

    const mode = withOneCarPlay.resolveCarPlayEntitlementMode();
    expect(mode).toBe("none");

    const result = withOneCarPlay.applyCarPlayEntitlements(
      {
        "keychain-access-groups": ["$(AppIdentifierPrefix)com.jasonroell.one"],
        [withOneCarPlay.CARPLAY_COMMUNICATION_ENTITLEMENT]: true,
      },
      mode,
    );

    expect(result[withOneCarPlay.CARPLAY_COMMUNICATION_ENTITLEMENT]).toBeUndefined();
    expect(result[withOneCarPlay.CARPLAY_AUDIO_ENTITLEMENT]).toBeUndefined();
    expect(result["keychain-access-groups"]).toEqual(["$(AppIdentifierPrefix)com.jasonroell.one"]);
  });

  it("adds com.apple.developer.carplay-communication when ONE_CARPLAY_ENTITLEMENT=1", () => {
    vi.stubEnv("ONE_CARPLAY_ENTITLEMENT", "1");
    vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "0");

    const mode = withOneCarPlay.resolveCarPlayEntitlementMode();
    expect(mode).toBe("communication");

    const result = withOneCarPlay.applyCarPlayEntitlements({}, mode);
    expect(result[withOneCarPlay.CARPLAY_COMMUNICATION_ENTITLEMENT]).toBe(true);
    expect(result[withOneCarPlay.CARPLAY_AUDIO_ENTITLEMENT]).toBeUndefined();
  });

  it("supports com.apple.developer.carplay-audio when ONE_CARPLAY_ENTITLEMENT=audio", () => {
    vi.stubEnv("ONE_CARPLAY_ENTITLEMENT", "audio");
    vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "0");

    const mode = withOneCarPlay.resolveCarPlayEntitlementMode();
    expect(mode).toBe("audio");

    const result = withOneCarPlay.applyCarPlayEntitlements({}, mode);
    expect(result[withOneCarPlay.CARPLAY_AUDIO_ENTITLEMENT]).toBe(true);
    expect(result[withOneCarPlay.CARPLAY_COMMUNICATION_ENTITLEMENT]).toBeUndefined();
  });

  it.each(["voice", "voice-based-conversation", " Voice "])(
    "adds only com.apple.developer.carplay-voice-based-conversation when ONE_CARPLAY_ENTITLEMENT=%j",
    (value) => {
      vi.stubEnv("ONE_CARPLAY_ENTITLEMENT", value);
      vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "0");

      const mode = withOneCarPlay.resolveCarPlayEntitlementMode();
      expect(mode).toBe("voice");

      const result = withOneCarPlay.applyCarPlayEntitlements(
        {
          [withOneCarPlay.CARPLAY_COMMUNICATION_ENTITLEMENT]: true,
          [withOneCarPlay.CARPLAY_AUDIO_ENTITLEMENT]: true,
        },
        mode,
      );
      expect(result[withOneCarPlay.CARPLAY_VOICE_ENTITLEMENT]).toBe(true);
      expect(result[withOneCarPlay.CARPLAY_COMMUNICATION_ENTITLEMENT]).toBeUndefined();
      expect(result[withOneCarPlay.CARPLAY_AUDIO_ENTITLEMENT]).toBeUndefined();
    },
  );

  it("reads the voice mode from the entitlementMode option before the environment", () => {
    vi.stubEnv("ONE_CARPLAY_ENTITLEMENT", "audio");
    vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "0");

    expect(withOneCarPlay.resolveCarPlayEntitlementMode({ entitlementMode: "voice" })).toBe(
      "voice",
    );
  });

  it("never combines the voice entitlement with another CarPlay category", () => {
    for (const mode of ["none", "communication", "audio", "both"]) {
      const result = withOneCarPlay.applyCarPlayEntitlements(
        { [withOneCarPlay.CARPLAY_VOICE_ENTITLEMENT]: true },
        mode,
      );
      expect(result[withOneCarPlay.CARPLAY_VOICE_ENTITLEMENT]).toBeUndefined();
    }
  });

  it("records the voice mode in Info.plist so the native scene avoids Now Playing", () => {
    const plist = withOneCarPlay.applyCarPlayInfoPlist({}, "voice");

    expect(plist.OneCarPlayEntitlementMode).toBe("voice");
    expect(plist.OneCarPlayEntitlementExpected).toBe(true);
    expect(plist.UIBackgroundModes).toEqual(["audio"]);
  });

  it("suppresses the voice entitlement for Personal Team builds", () => {
    vi.stubEnv("ONE_CARPLAY_ENTITLEMENT", "voice");
    vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "1");

    expect(withOneCarPlay.resolveCarPlayEntitlementMode()).toBe("none");
  });

  it("suppresses CarPlay entitlements for Personal Team builds even if ONE_CARPLAY_ENTITLEMENT=1", () => {
    vi.stubEnv("ONE_CARPLAY_ENTITLEMENT", "1");
    vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "1");

    expect(withOneCarPlay.resolveCarPlayEntitlementMode()).toBe("none");
  });

  it("ensures Android manifest includes RECORD_AUDIO and MODIFY_AUDIO_SETTINGS permissions", async () => {
    const projectRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "one-carplay-plugin-"));
    projectRoots.push(projectRoot);
    const manifestPath = NodePath.join(projectRoot, "android/app/src/main/AndroidManifest.xml");
    NodeFS.mkdirSync(NodePath.dirname(manifestPath), { recursive: true });
    NodeFS.writeFileSync(manifestPath, ANDROID_MANIFEST);

    const config = withOneCarPlay({
      name: "One",
      slug: "one",
    });

    await compileModsAsync(config, {
      projectRoot,
      platforms: ["android"],
    });

    const parsed = (await XML.parseXMLAsync(
      NodeFS.readFileSync(manifestPath, "utf8"),
    )) as AndroidConfig.Manifest.AndroidManifest;
    const permissions = AndroidConfig.Permissions.getPermissions(parsed);

    expect(permissions.filter((p) => p === "android.permission.RECORD_AUDIO")).toHaveLength(1);
    expect(
      permissions.filter((p) => p === "android.permission.MODIFY_AUDIO_SETTINGS"),
    ).toHaveLength(1);
  });
});
