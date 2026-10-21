import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { HpcHost } from "./quotaFetcher";

// 伺服器沒內建中文字型，圖表裡的中文會變方框，用系統裝好的 Noto Sans CJK。
const CJK_FONT_PATH = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";
const CJK_FONT_FAMILY = "Noto Sans CJK";
if (!GlobalFonts.has(CJK_FONT_FAMILY)) {
  GlobalFonts.registerFromPath(CJK_FONT_PATH, CJK_FONT_FAMILY);
}

export interface PersonBarData {
  name: string;
  pricesByHost: Partial<Record<HpcHost, number>>; // 元
}

const HOST_COLOR: Record<HpcHost, string> = {
  f1: "#5865F2", // Discord 藍
  nano4: "#57F287", // 綠
};

const HOST_CHART_LABEL: Record<HpcHost, string> = {
  f1: "F1",
  nano4: "nano4",
};

const HOSTS: HpcHost[] = ["f1", "nano4"];

// 畫「用人當單位、三段色堆疊（F1 藍/nano4 綠/合計數字）」的柱狀圖，回傳 PNG buffer。
export function renderQuotaBarChart(people: PersonBarData[], title: string): Buffer {
  const width = 900;
  const barAreaHeight = 460;
  const marginTop = 70;
  const marginBottom = 90;
  const marginLeft = 70;
  const marginRight = 40;
  const height = marginTop + barAreaHeight + marginBottom;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // 背景
  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 24px ${CJK_FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.fillText(title, width / 2, 40);

  const totals = people.map((p) => HOSTS.reduce((s, h) => s + (p.pricesByHost[h] ?? 0), 0));
  const maxTotal = Math.max(1, ...totals);

  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = barAreaHeight;
  const baseY = marginTop + plotHeight;

  // 水平格線 + Y 軸刻度（5 段）
  ctx.strokeStyle = "#4a4d53";
  ctx.fillStyle = "#b5b8bd";
  ctx.font = `12px ${CJK_FONT_FAMILY}`;
  ctx.textAlign = "right";
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const y = marginTop + plotHeight - (plotHeight * i) / gridLines;
    const value = (maxTotal * i) / gridLines;
    ctx.beginPath();
    ctx.moveTo(marginLeft, y);
    ctx.lineTo(width - marginRight, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(0), marginLeft - 8, y + 4);
  }

  const n = people.length;
  const slot = plotWidth / n;
  const barWidth = Math.min(70, slot * 0.55);

  people.forEach((p, i) => {
    const cx = marginLeft + slot * i + slot / 2;
    let y = baseY;
    for (const host of HOSTS) {
      const v = p.pricesByHost[host] ?? 0;
      if (v <= 0) continue;
      const h = (v / maxTotal) * plotHeight;
      ctx.fillStyle = HOST_COLOR[host];
      ctx.fillRect(cx - barWidth / 2, y - h, barWidth, h);
      y -= h;
    }
    // 合計數字
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 13px ${CJK_FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText(`約${totals[i].toFixed(0)}元`, cx, y - 8);
    // 人名
    ctx.fillStyle = "#dcddde";
    ctx.font = `13px ${CJK_FONT_FAMILY}`;
    ctx.fillText(p.name, cx, baseY + 20);
  });

  // 圖例
  let lx = marginLeft;
  const ly = height - 24;
  ctx.font = `13px ${CJK_FONT_FAMILY}`;
  for (const host of HOSTS) {
    ctx.fillStyle = HOST_COLOR[host];
    ctx.fillRect(lx, ly - 10, 14, 14);
    ctx.fillStyle = "#dcddde";
    ctx.textAlign = "left";
    ctx.fillText(HOST_CHART_LABEL[host], lx + 20, ly + 1);
    lx += 90;
  }

  return canvas.toBuffer("image/png");
}
