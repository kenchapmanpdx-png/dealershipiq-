// Sinch Conversation API types
// Ref: Build Master Phase 2A

export interface SinchInboundMessage {
  app_id: string;
  accepted_time: string;
  event_time: string;
  project_id: string;
  message: {
    id: string;
    direction: 'TO_APP';
    contact_message: {
      text_message?: { text: string };
    };
    channel_identity: {
      channel: 'SMS';
      identity: string; // E.164 phone number
      app_id: string;
    };
    conversation_id: string;
    contact_id: string;
    metadata: string;
    accept_time: string;
  };
  message_metadata: string;
}

export interface SinchDeliveryReport {
  app_id: string;
  accepted_time: string;
  event_time: string;
  project_id: string;
  message_delivery_report: {
    message_id: string;
    conversation_id: string;
    status: 'QUEUED_ON_CHANNEL' | 'DELIVERED' | 'FAILED';
    channel_identity: {
      channel: 'SMS';
      identity: string;
      app_id: string;
    };
    contact_id: string;
    metadata: string;
  };
}

export type SinchWebhookPayload = SinchInboundMessage | SinchDeliveryReport;

export interface SinchOAuthToken {
  access_token: string;
  expires_in: number; // seconds
  token_type: 'bearer';
  scope: string;
}

export interface SinchSendMessageRequest {
  app_id: string;
  recipient: {
    identified_by: {
      channel_identities: Array<{
        channel: 'SMS';
        identity: string;
      }>;
    };
  };
  message: {
    text_message: {
      text: string;
    };
  };
  channel_priority_order: ['SMS'];
  message_metadata?: string;
  processing_strategy?: 'DEFAULT' | 'DISPATCH_ONLY';
}

export interface SinchSendMessageResponse {
  message_id: string;
  accepted_time: string;
}

export interface SinchConsentEntry {
  identity: string;
  status: 'OPT_IN' | 'OPT_OUT';
  updated_at: string;
  channel: string;
}
