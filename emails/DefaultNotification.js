import { jsx, jsxs } from "react/jsx-runtime";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text
} from "@react-email/components";
function DefaultNotification({
  clientName = "Demo Restaurant",
  formId = "demo-contact",
  fields = [
    { label: "Name", value: "Ana Souza" },
    { label: "Email", value: "ana@example.com" },
    { label: "Message", value: "Hi! Do you take group bookings for Friday evenings?" }
  ],
  accentColor = "#8a3324",
  logoUrl,
  submissionId
}) {
  const preview = fields.find((f) => f.label.toLowerCase() === "message")?.value.slice(0, 120) ?? `New ${formId} submission`;
  return /* @__PURE__ */ jsxs(Html, { lang: "en", children: [
    /* @__PURE__ */ jsx(Head, {}),
    /* @__PURE__ */ jsx(Preview, { children: preview }),
    /* @__PURE__ */ jsx(Body, { style: styles.body, children: /* @__PURE__ */ jsxs(Container, { style: styles.container, children: [
      /* @__PURE__ */ jsxs(Section, { style: { ...styles.header, borderTop: `4px solid ${accentColor}` }, children: [
        logoUrl ? /* @__PURE__ */ jsx(Img, { src: logoUrl, alt: clientName, height: "26", style: styles.logo }) : /* @__PURE__ */ jsx(Text, { style: styles.clientName, children: clientName }),
        /* @__PURE__ */ jsx(Text, { style: styles.formLabel, children: "Website form submission" })
      ] }),
      /* @__PURE__ */ jsx(Section, { style: styles.card, children: fields.map((field, i) => /* @__PURE__ */ jsxs(Section, { children: [
        i > 0 && /* @__PURE__ */ jsx(Hr, { style: styles.hr }),
        /* @__PURE__ */ jsx(Text, { style: styles.fieldLabel, children: field.label }),
        /* @__PURE__ */ jsx(Text, { style: styles.fieldValue, children: field.value })
      ] }, field.label)) }),
      /* @__PURE__ */ jsxs(Section, { children: [
        /* @__PURE__ */ jsx(Text, { style: styles.footer, children: "Reply to this email to respond directly to the sender." }),
        submissionId ? /* @__PURE__ */ jsxs(Text, { style: styles.footerRef, children: [
          "Ref ",
          submissionId
        ] }) : null
      ] })
    ] }) })
  ] });
}
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
  hr: { borderColor: "#ececea", margin: "4px 0" },
  fieldLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#8a8a86",
    margin: "12px 0 2px"
  },
  fieldValue: {
    fontSize: "15px",
    lineHeight: "1.55",
    color: "#1a1a1a",
    margin: 0,
    whiteSpace: "pre-wrap"
  },
  footer: {
    fontSize: "12px",
    color: "#a0a09b",
    textAlign: "center",
    margin: "16px 0 0"
  },
  footerRef: {
    fontSize: "12px",
    color: "#a0a09b",
    textAlign: "center",
    margin: "4px 0 0"
  }
};
export {
  DefaultNotification as default
};
