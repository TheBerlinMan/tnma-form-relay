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
  accentColor?: string;
  logoUrl?: string;
}

/**
 * Commission waitlist confirmation — the visitor's thanks after signing up at
 * commission.tnma.me once all spots are filled.
 *
 * Sibling to CommissionReply and shares its voice ("Hey", signed off by name)
 * and palette. Deliberately has no promoCode block: WaitlistThanks carries
 * that for storefront clients, but a commission waitlist has nothing to
 * discount, and a code here would read as marketing rather than a note.
 *
 * The closed-spots view collects an email only, so `visitorName` is normally
 * undefined and the greeting degrades to a bare "Hey,".
 */
export default function WaitlistCommission({
  clientName = 'TNMA Commission',
  visitorName,
  body = [
    "Thanks for signing up — you're on the list.",
  ],
  accentColor = '#8db3dd',
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
            <Text style={styles.paragraph}>{visitorName ? `Hey ${visitorName},` : 'Hey,'}</Text>
            {body.map((paragraph, i) => (
              <Text key={i} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}

            <Text style={styles.signoff}>Best,</Text>
            <Text style={styles.signature}>Tommy</Text>
          </Section>

          <Section>
            <Text style={styles.footer}>
              You can reply to this email if you&apos;d like to add anything.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

WaitlistCommission.PreviewProps = {
  logoUrl: 'https://form-relay-eta.vercel.app/tnma.png',
  body: [
    "Thanks for signing up — you're on the list.",
    "If a spot opens up in this round, or when the next round of commissions opens, you'll hear from me here.",
  ],
} satisfies Partial<Props>;

const styles: Record<string, React.CSSProperties> = {
  body: {
    backgroundColor: '#faf7f1',
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
  signoff: {
    fontSize: '15px',
    lineHeight: '1.55',
    color: '#1a1a1a',
    margin: '22px 0 0',
  },
  signature: {
    fontSize: '15px',
    lineHeight: '1.55',
    color: '#1a1a1a',
    margin: '2px 0 0',
  },
  footer: {
    fontSize: '12px',
    color: '#a0a09b',
    textAlign: 'center' as const,
    margin: '16px 0 0',
  },
};
