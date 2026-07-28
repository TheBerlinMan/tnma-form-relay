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
function WaitlistCommission({
  clientName = "TNMA Commission",
  visitorName,
  body = [
    "Thanks for signing up \u2014 you're on the list."
  ],
  accentColor = "#8db3dd",
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
        /* @__PURE__ */ jsx(Text, { style: styles.paragraph, children: visitorName ? `Hey ${visitorName},` : "Hey," }),
        body.map((paragraph, i) => /* @__PURE__ */ jsx(Text, { style: styles.paragraph, children: paragraph }, i)),
        /* @__PURE__ */ jsx(Text, { style: styles.signoff, children: "Best," }),
        /* @__PURE__ */ jsx(Text, { style: styles.signature, children: "Tommy" })
      ] }),
      /* @__PURE__ */ jsx(Section, { children: /* @__PURE__ */ jsx(Text, { style: styles.footer, children: "You can reply to this email if you'd like to add anything." }) })
    ] }) })
  ] });
}
WaitlistCommission.PreviewProps = {
  accentColor: "#8db3dd",
  logoUrl: "https://form-relay-eta.vercel.app/tnma.png",
  body: [
    "Thanks for signing up \u2014 you're on the list.",
    "If a spot opens up in this round, or when the next round of commissions opens, you'll hear from me here."
  ]
};
const styles = {
  body: {
    backgroundColor: "#faf7f1",
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
  signoff: {
    fontSize: "15px",
    lineHeight: "1.55",
    color: "#1a1a1a",
    margin: "22px 0 0"
  },
  signature: {
    fontSize: "15px",
    lineHeight: "1.55",
    color: "#1a1a1a",
    margin: "2px 0 0"
  },
  footer: {
    fontSize: "12px",
    color: "#a0a09b",
    textAlign: "center",
    margin: "16px 0 0"
  }
};
export {
  WaitlistCommission as default
};
