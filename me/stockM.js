/** @param {NS} ns */
export async function main(ns) {
  ns.ui.openTail();
  const SCRIPT = 'me/stock.js';
  const CHECK_INTERVAL = 5000;
  const MONITOR_INTERVAL = 1000;
  const HOST = ns.getHostname(); // 确保仅在当前主机监控

  while (!ns.stock.has4SDataTIXAPI()) await ns.sleep(CHECK_INTERVAL);

  while (true) {
      if (!ns.scriptRunning(SCRIPT, HOST)) {
          const ramNeeded = ns.getScriptRam(SCRIPT);
          const availableRam = ns.getServerMaxRam(HOST) - ns.getServerUsedRam(HOST);
          if (availableRam >= ramNeeded) {
              ns.run(SCRIPT); // 单线程启动
              ns.toast(`启动 ${SCRIPT} 于 ${HOST}`, 'success');
          } else {
              ns.toast(`内存不足！需要 ${ns.formatRam(ramNeeded)}，可用 ${ns.formatRam(availableRam)}`, 'warning');
          }
      }
      await ns.sleep(MONITOR_INTERVAL);
  }
}
