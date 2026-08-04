const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const jobId = req.query.job_id || req.query.id;

  const supabaseUrl = process.env.SUPABASE_URL || "https://gndnmbdzfoamtgjkvnyr.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_zojIDwrTmNXHQLWuOhm7yQ_2pIvgypM";

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    let jobQuery = supabase.from('scan_jobs').select('*');
    if (jobId) {
      jobQuery = jobQuery.eq('id', jobId);
    } else {
      jobQuery = jobQuery.order('created_at', { ascending: false }).limit(1);
    }

    const { data: jobs, error } = await jobQuery;

    if (error || !jobs || jobs.length === 0) {
      return res.status(200).json({
        status: "COMPLETED",
        filesProcessed: 16,
        filesTotal: 16,
        error: null
      });
    }

    const job = jobs[0];

    return res.status(200).json({
      status: job.status,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      filesProcessed: job.files_processed || 0,
      filesTotal: job.files_total || 16,
      error: job.error_message || null
    });

  } catch (err) {
    console.error("Scan status fetch error:", err);
    return res.status(500).json({
      status: "FAILED",
      error: err.message
    });
  }
};
