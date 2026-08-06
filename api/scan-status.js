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
        status: "NO_JOB_FOUND",
        foldersFound: 0,
        filesFound: 0,
        filesProcessed: 0,
        resultsSaved: 0,
        newEnterprisesFound: 0,
        error: jobId ? `No scan job found with ID: ${jobId}` : "No scan jobs found. Trigger a scan first."
      });
    }

    const job = jobs[0];

    return res.status(200).json({
      status: job.status,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      foldersFound: job.folders_found || 0,
      filesFound: job.files_found || 0,
      filesProcessed: job.files_processed || 0,
      filesTotal: job.files_total || 0,
      resultsSaved: job.results_saved || 0,
      newEnterprisesFound: job.new_enterprises_found || 0,
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
