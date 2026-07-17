import { ImageResponse } from "next/og";

const size = {
  height: 630,
  width: 1200,
};

const alt = "Shadscan, the UI audit CLI for shadcn apps";
const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#fafafa",
        color: "#171217",
        display: "flex",
        fontFamily: "sans-serif",
        height: "100%",
        padding: "64px",
        width: "100%",
      }}
    >
      <div
        style={{
          background: "#a20a8f",
          display: "flex",
          width: "14px",
        }}
      />
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "space-between",
          paddingLeft: "48px",
        }}
      >
        <div style={{ display: "flex", fontSize: "30px", fontWeight: 700 }}>
          SHADSCAN
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: "76px",
              fontWeight: 700,
              letterSpacing: "0",
              lineHeight: 1.05,
              maxWidth: "850px",
            }}
          >
            Find the UI fundamentals your shadcn app forgot.
          </div>
          <div
            style={{
              color: "#655d65",
              display: "flex",
              fontSize: "30px",
              marginTop: "28px",
            }}
          >
            Deterministic checks. Evidence. Agent-ready fixes.
          </div>
        </div>
        <div
          style={{
            border: "2px solid #d9d3d8",
            display: "flex",
            fontFamily: "monospace",
            fontSize: "24px",
            padding: "16px 22px",
            width: "auto",
          }}
        >
          pnpm dlx shadscan
        </div>
      </div>
    </div>,
    size
  );
}

export { alt, contentType, size };
