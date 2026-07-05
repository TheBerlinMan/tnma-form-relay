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
 * Auto-reply template — the visitor's confirmation after a contact-form
 * submission. Same correspondence style as DefaultNotification: no images,
 * no tracked links, no buttons. The footer points the opposite direction:
 * replies from the visitor go back to the client.
 *
 * No inline default for `visitorName` — a default would leak into real sends
 * when the form has no name field. Preview data lives in PreviewProps.
 */
export default function AutoReply({
  clientName = 'Demo Restaurant',
  visitorName,
  body = [
    'Thanks for getting in touch — we received your message and will reply as soon as we can.',
    'If it is urgent, call us directly; the number is on our website.',
  ],
  accentColor = '#8a3324',
  logoUrl,
}: Props) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{body[0]?.slice(0, 120) ?? `Thanks for contacting ${clientName}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={{ ...styles.header, borderTop: `4px solid ${accentColor}` }}>
            {logoUrl ? (
              <Img src={logoUrl} alt={clientName} height="26" style={styles.logo} />
            ) : (
              <Text style={styles.clientName}>{clientName}</Text>
            )}
            <Text style={styles.formLabel}>We got your message</Text>
          </Section>

          <Section style={styles.card}>
            <Text style={styles.paragraph}>{visitorName ? `Hi ${visitorName},` : 'Hi,'}</Text>
            {body.map((paragraph, i) => (
              <Text key={i} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
          </Section>

          <Section>
            <Text style={styles.footer}>
              Reply to this email if you&apos;d like to add anything.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

AutoReply.PreviewProps = { visitorName: 'Ana' } satisfies Partial<Props>;

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
  footer: {
    fontSize: '12px',
    color: '#a0a09b',
    textAlign: 'center' as const,
    margin: '16px 0 0',
  },
};
