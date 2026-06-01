import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
  }

  // Client com JWT do usuário para validar autenticação e pegar user.id
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
  }

  const { fazenda_id } = await req.json()
  if (!fazenda_id) {
    return new Response(JSON.stringify({ error: 'Missing fazenda_id' }), { status: 400, headers: corsHeaders })
  }

  // Admin client (service role) para atualizar app_metadata
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Validar que fazenda_id existe
  const { data: fazenda } = await adminClient
    .from('fazendas')
    .select('id')
    .eq('id', fazenda_id)
    .single()

  if (!fazenda) {
    return new Response(JSON.stringify({ error: 'Fazenda não encontrada' }), { status: 400, headers: corsHeaders })
  }

  // Atualizar JWT claims do usuário
  const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
    app_metadata: { fazenda_ativa_id: fazenda_id }
  })

  if (updateError) {
    return new Response(JSON.stringify({ error: 'Falha ao atualizar' }), { status: 500, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
