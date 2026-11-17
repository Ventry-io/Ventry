interface RoomInvitationMailProps {
  inviterName: string;
  eventName: string;
  roomTypeName: string;
  inviteUrl: string;
  expiresAt: string;
}

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    maxWidth: "640px",
    margin: "0 auto",
    padding: "24px",
    color: "#1f2937",
  },
  title: { margin: "0 0 12px", fontSize: "24px" },
  paragraph: { margin: "0 0 14px", fontSize: "15px", lineHeight: 1.6 },
  note: { margin: "14px 0 0", fontSize: "13px", lineHeight: 1.5, color: "#64748b" },
  button: {
    display: "inline-block",
    backgroundColor: "#1976d2",
    color: "#ffffff",
    borderRadius: "8px",
    textDecoration: "none",
    padding: "12px 18px",
    fontWeight: 600,
    marginTop: "8px",
  },
};

export default function RoomInvitationMail({ inviterName, eventName, roomTypeName, inviteUrl, expiresAt }: RoomInvitationMailProps) {
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Roommate invitation</h1>
      <p style={styles.paragraph}>
        <strong>{inviterName}</strong> invited you to share their {roomTypeName} at <strong>{eventName}</strong>.
      </p>
      <p style={styles.paragraph}>Your bed is reserved until {expiresAt}. Accept or decline on the room page.</p>
      <a href={inviteUrl} style={styles.button}>
        View invitation
      </a>
      <p style={styles.note}>
        The link only works for your Ventry account. If you already booked a room yourself, you can release it when accepting.
      </p>
    </div>
  );
}
