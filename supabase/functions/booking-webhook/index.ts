
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create a Supabase client with the service role key (needed for database triggers)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Get the request body
    const body = await req.json();
    const { record, type } = body;

    console.log(`Webhook received ${type} event for record:`, record);

    // Process reservation events (not just inserts)
    if (record) {
      console.log(`Processing ${type} event for reservation ID: ${record.id}`);
      
      // For status updates, add extra logging
      if (type === 'UPDATE' && body.old && body.old.status !== record.status) {
        console.log(`Status changed from ${body.old.status} to ${record.status}`);
      }
      
      // Format the data to send to the webhook
      const bookingData = {
        id: record.id,
        name: record.name,
        phone: record.phone,
        date: record.date,
        timeSlot: record.time_slot,
        status: record.status,
        createdAt: record.created_at,
        eventType: type
      };

      // Get webhook URL from environment variable, with fallback
      const webhookUrl = Deno.env.get('WEBHOOK_URL') ?? "https://winu.app.n8n.cloud/webhook/8feeb3e5-0491-4c35-99ce-d3527c13cd59";
      
      console.log(`Sending booking data to webhook: ${webhookUrl}`);
      
      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bookingData),
      });

      if (!webhookResponse.ok) {
        throw new Error(`Webhook error: ${webhookResponse.status} ${await webhookResponse.text()}`);
      }

      console.log('Successfully sent booking to webhook:', await webhookResponse.text());
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Nothing to process' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
