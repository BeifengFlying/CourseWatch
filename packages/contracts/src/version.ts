import metadata from "../../../package.json" with { type: "json" };

export const APP_VERSION = metadata.version;
export const DESKTOP_BUILD = metadata.desktopBuild;
