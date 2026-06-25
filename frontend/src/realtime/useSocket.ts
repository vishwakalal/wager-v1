import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "../config/api";

/**
 * Connect to the Wager Socket.io server, join rooms for the given IDs,
 * and listen for named events. The connection is torn down on unmount.
 *
 * Usage:
 *   useSocket({ circleIds: ["abc"], betIds: ["xyz"], onEvent: (ev, data) => ... })
 */
export function useSocket({
  circleIds = [],
  betIds = [],
  onEvent,
}: {
  circleIds?: string[];
  betIds?: string[];
  onEvent?: (event: string, data: unknown) => void;
}) {
  const socketRef = useRef<Socket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const joinRooms = useCallback((socket: Socket) => {
    circleIds.forEach((id) => socket.emit("join:circle", { circleId: id }));
    betIds.forEach((id) => socket.emit("join:bet", { betId: id }));
  }, [circleIds, betIds]);

  useEffect(() => {
    const wsUrl = API_BASE_URL.replace("/api", "");
    const socket = io(wsUrl, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => joinRooms(socket));

    const events = [
      "bet:created",
      "bet:odds_locked",
      "bet:status_changed",
      "bet:verification_updated",
      "bet:dispute_resolved",
    ];
    events.forEach((ev) => {
      socket.on(ev, (data: unknown) => onEventRef.current?.(ev, data));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [joinRooms]);
}
