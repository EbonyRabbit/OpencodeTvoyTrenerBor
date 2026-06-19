export type ActivityEvent = {
  id: string;
  date: string;
  event_type: "workout" | "checkin" | "measurement" | "photo" | "message" | "notification";
  details: Record<string, unknown>;
};

export const ACTIVITY_PAGE_SIZE = 30;
