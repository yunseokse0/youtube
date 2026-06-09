import PlayerAlertMuteAudio from "@/components/donation/PlayerAlertMuteAudio";

export default function PlayerAlertLayout({ children }: { children: React.ReactNode }) {
  return <PlayerAlertMuteAudio>{children}</PlayerAlertMuteAudio>;
}
