/**
 * 配置管理门面模块 (ConfigManager Facade)
 * 对外统一聚合提供配置存储、场景领域操作、剪贴板序列化与启动推导等能力，保持 100% 向后兼容
 */

export * from "./config/configStorage";
export * from "./config/sceneOperations";
export * from "./config/payloadSerializer";
export * from "./config/launchResolver";
