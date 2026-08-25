// Minimal stub of the obsidian package for unit testing pure functions
export const App = class {};
export const TFile = class {};
export const normalizePath = (p: string) => p;
export const Notice = class { constructor(_msg: string) {} };
export const Modal = class { constructor(_app: unknown) {} onOpen() {} onClose() {} };
export const Plugin = class {};
export const PluginSettingTab = class { constructor(_app: unknown, _plugin: unknown) {} display() {} };
export const Setting = class { constructor(_el: unknown) {} };
export const ItemView = class {};
export const WorkspaceLeaf = class {};
export const setIcon = () => {};
export const Platform = { isMobile: false };
export const Events = class {};
