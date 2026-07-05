import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface Props {
  clientName: string;
  visitorName?: string;
  body: string[];
  promoCode?: string;
  accentColor?: string;
  logoUrl?: string;
}

/**
 * Waitlist thanks template — confirms the signup and (optionally) hands over
 * a static promo code. Correspondence style per the standing rules: the code
 * is plain text in a bordered block, never a tracked link or button.
 *
 * No inline defaults for `visitorName`/`promoCode` — a default would leak
 * into real sends when the form omits them. Preview data lives in
 * PreviewProps.
 */
export default function WaitlistThanks({
  clientName = 'Demo Restaurant',
  visitorName,
  body = [
    "Thanks for signing up — you're on the list.",
    "We'll only email you when there's something worth hearing about.",
  ],
  promoCode,
  accentColor = '#8a3324',
  logoUrl,
}: Props) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{body[0]?.slice(0, 120) ?? "You're on the list"}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={{ ...styles.header, borderTop: `4px solid ${accentColor}` }}>
            {logoUrl ? (
              <Img src={logoUrl} alt={clientName} height="26" style={styles.logo} />
            ) : (
              <Text style={styles.clientName}>{clientName}</Text>
            )}
            <Text style={styles.formLabel}>You&apos;re on the list</Text>
          </Section>

          <Section style={styles.card}>
            <Text style={styles.paragraph}>{visitorName ? `Hi ${visitorName},` : 'Hi,'}</Text>
            {body.map((paragraph, i) => (
              <Text key={i} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
            {promoCode ? (
              <Section>
                <Text style={styles.promoLabel}>A little thanks — use this code</Text>
                <Text style={styles.promoCode}>{promoCode}</Text>
              </Section>
            ) : null}
          </Section>

          <Section>
            <Text style={styles.footer}>
              Reply to this email if you have any questions.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

WaitlistThanks.PreviewProps = {
  visitorName: 'Ana',
  promoCode: 'WELCOME10',
} satisfies Partial<Props>;

const styles: Record<string, React.CSSProperties> = {
  body: {
    backgroundColor: '#f5f4f1',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    margin: 0,
    padding: '24px 12px',
  },
  container: { maxWidth: '560px', margin: '0 auto' },
  header: {
    backgroundColor: '#ffffff',
    borderRadius: '8px 8px 0 0',
    padding: '20px 28px 12px',
  },
  clientName: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#1a1a1a',
    margin: '0 0 2px',
  },
  logo: { margin: '0 0 6px' },
  formLabel: {
    fontSize: '12px',
    color: '#8a8a86',
    letterSpacing: '0.02em',
    margin: 0,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '0 0 8px 8px',
    padding: '8px 28px 20px',
  },
  paragraph: {
    fontSize: '15px',
    lineHeight: '1.55',
    color: '#1a1a1a',
    margin: '12px 0 0',
  },
  promoLabel: {
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: '#8a8a86',
    margin: '20px 0 6px',
    textAlign: 'center' as const,
  },
  promoCode: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
    fontSize: '18px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: '#1a1a1a',
    border: '1px dashed #c9c8c3',
    borderRadius: '6px',
    padding: '12px 0',
    margin: 0,
    textAlign: 'center' as const,
  },
};
