// 初始化与后续切换共用：模式只决定入口开放程度，不自动选择生产服务商或创建云资源。
export const LAUNCH_MODES = {
  local: { SHOWCASE_MODE: 'false', AUTH_ENABLED: 'true', GENERATION_ENABLED: 'true', PAYMENTS_ENABLED: 'true' },
  showcase: { SHOWCASE_MODE: 'true', AUTH_ENABLED: 'false', GENERATION_ENABLED: 'false', PAYMENTS_ENABLED: 'false' },
  accounts: { SHOWCASE_MODE: 'false', AUTH_ENABLED: 'true', GENERATION_ENABLED: 'false', PAYMENTS_ENABLED: 'false' },
  generate: { SHOWCASE_MODE: 'false', AUTH_ENABLED: 'true', GENERATION_ENABLED: 'true', PAYMENTS_ENABLED: 'false' },
  full: { SHOWCASE_MODE: 'false', AUTH_ENABLED: 'true', GENERATION_ENABLED: 'true', PAYMENTS_ENABLED: 'true' },
}

export function launchVars(mode) {
  if (!Object.hasOwn(LAUNCH_MODES, mode)) throw new Error(`launch 只支持 ${Object.keys(LAUNCH_MODES).join('、')}`)
  return { ...LAUNCH_MODES[mode] }
}

export function patchWranglerVars(source, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('不支持的环境变量名称')
    const regex = new RegExp(`("${key}"\\s*:\\s*)"[^"\\n]*"`, 'g')
    if ([...source.matchAll(regex)].length !== 1) throw new Error(`wrangler vars 无法唯一定位 ${key}，请先同步最新模板`)
    source = source.replace(regex, (_, prefix) => prefix + JSON.stringify(value))
  }
  return source
}
