import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface Field {
  label: string;
  value: string;
}

interface Props {
  clientName: string;
  formId: string;
  fields: Field[];
  accentColor?: string;
  logoUrl?: string;
  submissionId?: string;
}

/**
 * Default notification template.
 * Deliberately correspondence-style: no images, no tracked links, no buttons —
 * it should read like mail, not marketing (better deliverability, faster scan).
 */
export default function DefaultNotification({
  clientName = 'Demo Restaurant',
  formId = 'demo-contact',
  fields = [
    { label: 'Name', value: 'Ana Souza' },
    { label: 'Email', value: 'ana@example.com' },
    { label: 'Message', value: 'Hi! Do you take group bookings for Friday evenings?' },
  ],
  accentColor = '#8a3324',
  logoUrl,
  submissionId,
}: Props) {
  const preview =
    fields.find((f) => f.label.toLowerCase() === 'message')?.value.slice(0, 120) ??
    `New ${formId} submission`;

  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={{ ...styles.header, borderTop: `4px solid ${accentColor}` }}>
            {logoUrl ? (
              <Img src={logoUrl} alt={clientName} height="26" style={styles.logo} />
            ) : (
              <Text style={styles.clientName}>{clientName}</Text>
            )}
            <Text style={styles.formLabel}>Website form submission</Text>
          </Section>

          <Section style={styles.card}>
            {fields.map((field, i) => (
              <Section key={field.label}>
                {i > 0 && <Hr style={styles.hr} />}
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <Text style={styles.fieldValue}>{field.value}</Text>
              </Section>
            ))}
          </Section>

          <Section>
            <Text style={styles.footer}>
              Reply to this email to respond directly to the sender.
            </Text>
            {submissionId ? (
              <Text style={styles.footerRef}>Ref {submissionId}</Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

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
  hr: { borderColor: '#ececea', margin: '4px 0' },
  fieldLabel: {
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: '#8a8a86',
    margin: '12px 0 2px',
  },
  fieldValue: {
    fontSize: '15px',
    lineHeight: '1.55',
    color: '#1a1a1a',
    margin: 0,
    whiteSpace: 'pre-wrap' as const,
  },
  footer: {
    fontSize: '12px',
    color: '#a0a09b',
    textAlign: 'center' as const,
    margin: '16px 0 0',
  },
  footerRef: {
    fontSize: '12px',
    color: '#a0a09b',
    textAlign: 'center' as const,
    margin: '4px 0 0',
  },
};
