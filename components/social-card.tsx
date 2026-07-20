import { ShadscanMark } from "@/components/shadscan-mark";

interface SocialCardProps {
  detail: string;
  footer: string;
  headline: string;
}

function SocialCard({ detail, footer, headline }: SocialCardProps) {
  return (
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
        <div
          style={{
            alignItems: "center",
            display: "flex",
            fontSize: "30px",
            fontWeight: 700,
            gap: "18px",
          }}
        >
          <ShadscanMark style={{ height: "52px", width: "52px" }} />
          <div style={{ display: "flex" }}>SHADSCAN</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: "76px",
              fontWeight: 700,
              letterSpacing: "0",
              lineHeight: 1.05,
              maxWidth: "890px",
            }}
          >
            {headline}
          </div>
          <div
            style={{
              color: "#655d65",
              display: "flex",
              fontSize: "30px",
              marginTop: "28px",
            }}
          >
            {detail}
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
          {footer}
        </div>
      </div>
    </div>
  );
}

export { SocialCard };
