import "server-only";
import { readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import tls from "node:tls";

// API MAX и GigaChat подписаны сертификатом Минцифры, которого нет в стандартном наборе Node
let agent: https.Agent | null = null;

export function ruTrustAgent() {
  if (!agent) {
    const certPath = process.env.RU_CA_CERT || process.env.MAX_CA_CERT || path.join(process.cwd(), "certs", "russian_trusted_root_ca.pem");
    let extra: string[] = [];
    try {
      extra = [readFileSync(certPath, "utf8")];
    } catch {
      console.warn(`[ru-ca] сертификат Минцифры не найден: ${certPath}`);
    }
    agent = new https.Agent({ ca: [...tls.rootCertificates, ...extra], keepAlive: true });
  }
  return agent;
}
