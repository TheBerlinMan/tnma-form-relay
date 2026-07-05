import { jsx, jsxs } from "react/jsx-runtime";
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text
} from "@react-email/components";
function WaitlistThanks({
  clientName = "Demo Restaurant",
  visitorName,
  body = [
    "Thanks for signing up \u2014 you're on the list.",
    "We'll only email you when there's something worth hearing about."
  ],
  promoCode,
  accentColor = "#8a3324",
  logoUrl
}) {
  return /* @__PURE__ */ jsxs(Html, { lang: "en", children: [
    /* @__PURE__ */ jsx(Head, {}),
    /* @__PURE__ */ jsx(Preview, { children: body[0]?.slice(0, 120) ?? "You're on the list" }),
    /* @__PURE__ */ jsx(Body, { style: styles.body, children: /* @__PURE__ */ jsxs(Container, { style: styles.container, children: [
      /* @__PURE__ */ jsxs(Section, { style: { ...styles.header, borderTop: `4px solid ${accentColor}` }, children: [
        logoUrl ? /* @__PURE__ */ jsx(Img, { src: logoUrl, alt: clientName, height: "26", style: styles.logo }) : /* @__PURE__ */ jsx(Text, { style: styles.clientName, children: clientName }),
        /* @__PURE__ */ jsx(Text, { style: styles.formLabel, children: "You're on the list" })
      ] }),
      /* @__PURE__ */ jsxs(Section, { style: styles.card, children: [
        /* @__PURE__ */ jsx(Text, { style: styles.paragraph, children: visitorName ? `Hi ${visitorName},` : "Hi," }),
        body.map((paragraph, i) => /* @__PURE__ */ jsx(Text, { style: styles.paragraph, children: paragraph }, i)),
        promoCode ? /* @__PURE__ */ jsxs(Section, { children: [
          /* @__PURE__ */ jsx(Text, { style: styles.promoLabel, children: "A little thanks \u2014 use this code" }),
          /* @__PURE__ */ jsx(Text, { style: styles.promoCode, children: promoCode })
        ] }) : null
      ] }),
      /* @__PURE__ */ jsx(Section, { children: /* @__PURE__ */ jsx(Text, { style: styles.footer, children: "Reply to this email if you have any questions." }) })
    ] }) })
  ] });
}
WaitlistThanks.PreviewProps = {
  visitorName: "Ana",
  promoCode: "WELCOME10"
};
const styles = {
  body: {
    backgroundColor: "#f5f4f1",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    margin: 0,
    padding: "24px 12px"
  },
  container: { maxWidth: "560px", margin: "0 auto" },
  header: {
    backgroundColor: "#ffffff",
    borderRadius: "8px 8px 0 0",
    padding: "20px 28px 12px"
  },
  clientName: {
    fontSize: "18px",
    fontWeight: 700,
    color: "#1a1a1a",
    margin: "0 0 2px"
  },
  logo: { margin: "0 0 6px" },
  formLabel: {
    fontSize: "12px",
    color: "#8a8a86",
    letterSpacing: "0.02em",
    margin: 0
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "0 0 8px 8px",
    padding: "8px 28px 20px"
  },
  paragraph: {
    fontSize: "15px",
    lineHeight: "1.55",
    color: "#1a1a1a",
    margin: "12px 0 0"
  },
  promoLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#8a8a86",
    margin: "20px 0 6px",
    textAlign: "center"
  },
  promoCode: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
    fontSize: "18px",
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "#1a1a1a",
    border: "1px dashed #c9c8c3",
    borderRadius: "6px",
    padding: "12px 0",
    margin: 0,
    textAlign: "center"
  }
};
export {
  WaitlistThanks as default
};
