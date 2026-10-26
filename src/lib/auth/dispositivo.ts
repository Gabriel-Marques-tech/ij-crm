/** "Chrome · Windows" a partir do user-agent (lista de sessões). Heurística simples, sem dependência. */
const NAVEGADORES: [RegExp, string][] = [
  [/Edg(A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"],
];

const SISTEMAS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function descreverDispositivo(ua: string | null | undefined): string {
  if (!ua) return "Dispositivo desconhecido";
  const nav = NAVEGADORES.find(([re]) => re.test(ua))?.[1];
  const so = SISTEMAS.find(([re]) => re.test(ua))?.[1];
  if (!nav && !so) return "Navegador desconhecido";
  return [nav ?? "Navegador", so].filter(Boolean).join(" · ");
}
