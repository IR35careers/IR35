[CmdletBinding()]
param([ValidateSet('export','catalog-repair','effective-privileges','platform-diagnosis','verify-acl-repair','owner-security-preflight','owner-expiry-probe')][string]$Operation = 'export')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$context = 'C:\Users\anves\.oci\ir35-p0-readonly'
$ca = 'C:\Users\anves\.codex\operations\ir35careers\supabase-prod-ca-2021.crt'
$privateEnvironment = @{}
try {
  Push-Location -LiteralPath $repository
  try {
    # Capture privately: this vendor-generated plan includes temporary credentials.
    $plan = npx --no-install supabase db dump --linked --dry-run --project-ref kxcbgflleqnjzjbkevwd --workdir $context 2>$null | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Private linked connection preparation failed; output withheld.' }
  } finally { Pop-Location }
  foreach ($field in [regex]::Matches($plan, '(?m)^\s*export\s+(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=["'']([^"''\r\n]*)["'']\s*$')) {
    $privateEnvironment[$field.Groups[1].Value] = $field.Groups[2].Value
  }
  if ($privateEnvironment.Count -ne 5 -or $privateEnvironment.PGHOST -ne 'aws-1-eu-west-2.pooler.supabase.com' -or
      $privateEnvironment.PGPORT -ne '5432' -or $privateEnvironment.PGDATABASE -ne 'postgres' -or
      -not $privateEnvironment.PGUSER.EndsWith('.kxcbgflleqnjzjbkevwd') -or -not $privateEnvironment.PGPASSWORD) {
    throw 'Source identity/session pooler validation failed; no values printed.'
  }
  $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem((Get-Content -LiteralPath $ca -Raw))
  if ($certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256) -ne '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA' -or $certificate.NotAfter -lt [DateTime]::Now) { throw 'Reviewed CA mismatch/expiry; never disable TLS.' }
  $privateEnvironment.PGSSLMODE = 'verify-full'
  $privateEnvironment.PGSSLROOTCERT = '/mnt/c/Users/anves/.codex/operations/ir35careers/supabase-prod-ca-2021.crt'
  $privateEnvironment.PGCONNECT_TIMEOUT = '15'
  $privateEnvironment.PGAPPNAME = 'ir35-readonly-schema-clone'
  $privateEnvironment.PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=300000 -c lock_timeout=5000'
  $start = [Diagnostics.ProcessStartInfo]::new('wsl.exe')
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.RedirectStandardInput = $true
  $linuxRepository = '/mnt/c/Users/anves/.codex/worktrees/bot-handoff/ir35careers'
  foreach ($argument in @('-d','Ubuntu','--cd',$linuxRepository,'/home/anvesh/.ir35/oci/bin/python','infra/oracle/cloud_schema.py',$Operation)) { $start.ArgumentList.Add($argument) }
  foreach ($name in $privateEnvironment.Keys) { $start.Environment[$name] = $privateEnvironment[$name] }
  $start.Environment['WSLENV'] = $privateEnvironment.Keys -join ':'
  [void]$start.Environment.Remove('BASH_ENV')
  [void]$start.Environment.Remove('ENV')
  $process = [Diagnostics.Process]::Start($start)
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(600000)) { $process.Kill($true); throw 'Read-only schema operation timed out; raw output withheld.' }
  # Only a strict, deliberately tiny public result can reach the terminal.
  $result = $stdout.GetAwaiter().GetResult() | ConvertFrom-Json
  if ($process.ExitCode -ne 0 -or $result.status -ne 'PASS') {
    $code = if ($result.code -match '^[A-Za-z0-9_:.-]{1,160}$') { $result.code } else { 'withheld' }
    throw ('Schema operation stopped; code=' + $code + '; raw stdout/stderr withheld.')
  }
  if ($result.PSObject.Properties.Name | Where-Object { $_ -notin @('status','operation','report','schemaBytes','rolesBytes','objects','sourceWrites','reused') }) { throw 'Unexpected public result fields; withheld.' }
  $result | ConvertTo-Json -Compress
} finally {
  $plan = $null
  $privateEnvironment.Clear()
}
