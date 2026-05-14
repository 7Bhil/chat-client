import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://mooctqjvxiqkxzdmshos.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vb2N0cWp2eGlxa3h6ZG1zaG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NjI2MDgsImV4cCI6MjA5NDIzODYwOH0.SCgVKhsVBaYOjGYoHekHEj82iypa4lCQ6YHR7nhS3BM';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  const { data: messages, error: err1 } = await supabase.from('messages').select('*').limit(5);
  console.log("MESSAGES FETCH:", err1 ? err1 : messages.map(m => ({ id: m.id, sender: m.sender_id, is_read: m.is_read })));

  if (messages && messages.length > 0) {
     const msg = messages[0];
     const { data, error } = await supabase.from('messages').update({ is_read: true }).eq('id', msg.id);
     console.log("UPDATE ATTEMPT:", error ? error : (data ? "Success" : "Success (no data returned)"));
  }
}
test();
