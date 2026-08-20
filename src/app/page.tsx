/*
  THE PLACEHOLDER.

  On devines.glazedweb.com this page answers /demo, because of the host split in
  next.config.ts. The concept build does not exist yet, and the honest behaviour for a
  route that has nothing behind it is to say so rather than to render an empty shell
  that reads as a broken site.

  The moment the real build lands, this file is replaced by the homepage and the words
  below go away. Until then: do not send this URL to anybody.
*/
export default function Placeholder() {
  return (
    <main
      style={{
        minHeight: "100svh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#FDF6EC",
        color: "#2B1E16",
        fontFamily:
          '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "34em" }}>
        <p
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#467C3D",
            margin: "0 0 14px",
          }}
        >
          Glazed Web
        </p>
        <h1
          style={{
            fontSize: "clamp(28px,5vw,40px)",
            fontWeight: 800,
            letterSpacing: "-1.2px",
            lineHeight: 1.1,
            margin: "0 0 16px",
          }}
        >
          Nothing here yet.
        </h1>
        <p style={{ color: "#6B5747", fontSize: "17px", lineHeight: 1.6, margin: 0 }}>
          This address is reserved for a concept build that has not been made. The
          proposal is at the root of this domain.
        </p>
      </div>
    </main>
  );
}
