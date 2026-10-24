import { readFile } from 'node:fs/promises'
import { createBridge } from './bridge.mjs'

const config = JSON.parse(await readFile(process.env.BRIDGE_CONFIG ?? 'bridge.config.json', 'utf8'))
const bridge = await createBridge(config, { token: process.env.BRIDGE_TOKEN, outputSecret: process.env.BRIDGE_OUTPUT_SECRET })
const address = await bridge.start()
console.log(`Hypit Bridge listening on ${address.address}:${address.port} (${config.mode})`)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await bridge.close(); process.exit(0) })
