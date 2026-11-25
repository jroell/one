"use strict";

const {
  AndroidConfig,
  withAndroidManifest,
  withEntitlementsPlist,
  withInfoPlist,
} = require("expo/config-plugins");

const CARPLAY_SCENE_ROLE = "CPTemplateApplicationSceneSessionRoleApplication";
const CARPLAY_SCENE_CONFIG = {
  UISceneClassName: "CPTemplateApplicationScene",
  UISceneConfigurationName: "OneCarPlayConfiguration",
  UISceneDelegateClassName: "OneCarPlaySceneDelegate",
};

const CARPLAY_COMMUNICATION_ENTITLEMENT = "com.apple.developer.carplay-communication";
const CARPLAY_AUDIO_ENTITLEMENT = "com.apple.developer.carplay-audio";

function resolveCarPlayEntitlementMode(options) {
  const isPersonalTeam =
    options?.isPersonalTeamBuild ?? process.env.T3CODE_IOS_PERSONAL_TEAM === "1";
  if (isPersonalTeam) {
    return "none";
  }

  const rawValue = (options?.entitlementMode ?? process.env.ONE_CARPLAY_ENTITLEMENT ?? "")
    .toString()
    .trim()
    .toLowerCase();

  if (rawValue === "1" || rawValue === "true" || rawValue === "communication") {
    return "communication";
  }
  if (rawValue === "audio") {
    return "audio";
  }
  if (rawValue === "both") {
    return "both";
  }
  return "none";
}

function applyCarPlayInfoPlist(infoPlist, entitlementEnabled) {
  const next = { ...infoPlist };

  const existingModes = Array.isArray(next.UIBackgroundModes)
    ? next.UIBackgroundModes.filter((mode) => typeof mode === "string")
    : [];
  if (!existingModes.includes("audio")) {
    existingModes.push("audio");
  }
  next.UIBackgroundModes = existingModes;

  const existingManifest =
    next.UIApplicationSceneManifest && typeof next.UIApplicationSceneManifest === "object"
      ? { ...next.UIApplicationSceneManifest }
      : {};
  const existingConfigurations =
    existingManifest.UISceneConfigurations &&
    typeof existingManifest.UISceneConfigurations === "object"
      ? { ...existingManifest.UISceneConfigurations }
      : {};

  const existingCarPlayScenes = Array.isArray(existingConfigurations[CARPLAY_SCENE_ROLE])
    ? existingConfigurations[CARPLAY_SCENE_ROLE].filter(
        (scene) =>
          scene && scene.UISceneDelegateClassName !== CARPLAY_SCENE_CONFIG.UISceneDelegateClassName,
      )
    : [];

  existingConfigurations[CARPLAY_SCENE_ROLE] = [
    ...existingCarPlayScenes,
    { ...CARPLAY_SCENE_CONFIG },
  ];
  existingManifest.UIApplicationSupportsMultipleScenes = true;
  existingManifest.UISceneConfigurations = existingConfigurations;

  next.UIApplicationSceneManifest = existingManifest;
  next.OneCarPlayEntitlementExpected = Boolean(entitlementEnabled);
  return next;
}

function applyCarPlayEntitlements(entitlements, mode) {
  const next = { ...entitlements };
  delete next[CARPLAY_COMMUNICATION_ENTITLEMENT];
  delete next[CARPLAY_AUDIO_ENTITLEMENT];

  if (mode === "communication" || mode === "both") {
    next[CARPLAY_COMMUNICATION_ENTITLEMENT] = true;
  }
  if (mode === "audio" || mode === "both") {
    next[CARPLAY_AUDIO_ENTITLEMENT] = true;
  }
  return next;
}

function withOneCarPlay(config, options = {}) {
  const entitlementMode = resolveCarPlayEntitlementMode(options);
  const entitlementEnabled = entitlementMode !== "none";

  let updated = withInfoPlist(config, (modConfig) => {
    modConfig.modResults = applyCarPlayInfoPlist(modConfig.modResults, entitlementEnabled);
    return modConfig;
  });

  updated = withEntitlementsPlist(updated, (modConfig) => {
    modConfig.modResults = applyCarPlayEntitlements(modConfig.modResults, entitlementMode);
    return modConfig;
  });

  updated = withAndroidManifest(updated, (modConfig) => {
    AndroidConfig.Permissions.ensurePermissions(modConfig.modResults, [
      "android.permission.RECORD_AUDIO",
      "android.permission.MODIFY_AUDIO_SETTINGS",
    ]);
    return modConfig;
  });

  return updated;
}

withOneCarPlay.CARPLAY_SCENE_ROLE = CARPLAY_SCENE_ROLE;
withOneCarPlay.CARPLAY_SCENE_CONFIG = CARPLAY_SCENE_CONFIG;
withOneCarPlay.CARPLAY_COMMUNICATION_ENTITLEMENT = CARPLAY_COMMUNICATION_ENTITLEMENT;
withOneCarPlay.CARPLAY_AUDIO_ENTITLEMENT = CARPLAY_AUDIO_ENTITLEMENT;
withOneCarPlay.applyCarPlayInfoPlist = applyCarPlayInfoPlist;
withOneCarPlay.applyCarPlayEntitlements = applyCarPlayEntitlements;
withOneCarPlay.resolveCarPlayEntitlementMode = resolveCarPlayEntitlementMode;

module.exports = withOneCarPlay;
