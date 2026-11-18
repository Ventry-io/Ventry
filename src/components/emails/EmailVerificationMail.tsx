interface EmailVerificationMailProps {
    userName: string;
    verificationUrl: string;
    expiryHours?: number;
    newEmail?: string;
}

const emailStyles = {
    container: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        maxWidth: '600px',
        margin: '0 auto',
        padding: '40px 20px',
        backgroundColor: '#ffffff',
    },
    header: {
        textAlign: 'center' as const,
        marginBottom: '40px',
    },
    logo: {
        fontSize: '32px',
        fontWeight: 'bold',
        color: '#1976d2',
        marginBottom: '8px',
    },
    title: {
        fontSize: '24px',
        fontWeight: '600',
        color: '#1a1a1a',
        marginBottom: '16px',
        marginTop: '0',
    },
    text: {
        fontSize: '16px',
        lineHeight: '1.6',
        color: '#4a4a4a',
        marginBottom: '24px',
    },
    buttonContainer: {
        textAlign: 'center' as const,
        margin: '32px 0',
    },
    button: {
        backgroundColor: '#4caf50',
        color: '#ffffff',
        padding: '14px 32px',
        textDecoration: 'none',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: '600',
        display: 'inline-block',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    },
    alternativeLink: {
        fontSize: '14px',
        color: '#666666',
        marginTop: '24px',
        padding: '16px',
        backgroundColor: '#f5f5f5',
        borderRadius: '4px',
        wordBreak: 'break-all' as const,
    },
    link: {
        color: '#1976d2',
        textDecoration: 'none',
    },
    warningBox: {
        backgroundColor: '#fff3cd',
        border: '1px solid #ffc107',
        borderRadius: '8px',
        padding: '16px',
        marginTop: '32px',
    },
    warningText: {
        fontSize: '14px',
        color: '#856404',
        margin: '0',
        lineHeight: '1.5',
    },
    footer: {
        marginTop: '48px',
        paddingTop: '24px',
        borderTop: '1px solid #e0e0e0',
        textAlign: 'center' as const,
    },
    footerText: {
        fontSize: '14px',
        color: '#999999',
        margin: '8px 0',
    },
    divider: {
        height: '1px',
        backgroundColor: '#e0e0e0',
        margin: '32px 0',
        border: 'none',
    },
};

export default function EmailVerificationMail({ 
    userName, 
    verificationUrl, 
    expiryHours = 24,
    newEmail,
}: EmailVerificationMailProps) {
    return (
        <div style={emailStyles.container}>
            {/* Header */}
            <div style={emailStyles.header}>
                <div style={emailStyles.logo}>✅ Ventry</div>
            </div>

            {/* Main Content */}
            <h1 style={emailStyles.title}>{newEmail ? 'Confirm Your Email Change' : 'Verify Your Email Address'}</h1>
            
            <p style={emailStyles.text}>
                Hi {userName},
            </p>

            <p style={emailStyles.text}>
                {newEmail
                    ? <>You requested to change your Ventry email address to <strong>{newEmail}</strong>. Approve this request below. We will then send a verification link to your new address. Your email stays unchanged until you verify it.</>
                    : 'To secure your Ventry account, please verify your email address by clicking the button below.'}
            </p>

            {/* CTA Button */}
            <div style={emailStyles.buttonContainer}>
                <a href={verificationUrl} style={emailStyles.button}>
                    {newEmail ? 'Confirm Email Change' : 'Verify Email Address'}
                </a>
            </div>

            <p style={emailStyles.text}>
                This verification link will expire in <strong>{expiryHours} {expiryHours === 1 ? 'hour' : 'hours'}</strong> for security reasons.
            </p>

            <hr style={emailStyles.divider} />

            {/* Alternative Link */}
            <p style={{ ...emailStyles.text, fontSize: '14px', marginBottom: '12px' }}>
                If the button above doesn&apos;t work, copy and paste this link into your browser:
            </p>
            <div style={emailStyles.alternativeLink}>
                <a href={verificationUrl} style={emailStyles.link}>
                    {verificationUrl}
                </a>
            </div>

            {/* Warning Box */}
            <div style={emailStyles.warningBox}>
                <p style={emailStyles.warningText}>
                    <strong>⚠️ Important:</strong><br />
                    If you didn&apos;t request this, you can safely ignore this email.
                    Your email address will not be changed or verified without confirmation.
                </p>
            </div>

            {/* Footer */}
            <div style={emailStyles.footer}>
                <p style={emailStyles.footerText}>
                    Need help? Contact our support team.
                </p>
                <p style={emailStyles.footerText}>
                    Best regards,<br />
                    Your Ventry Team
                </p>
                <p style={emailStyles.footerText}>
                    © {new Date().getFullYear()} Ventry. All rights reserved.
                </p>
            </div>
        </div>
    );
}

export { EmailVerificationMail };
export type { EmailVerificationMailProps };
