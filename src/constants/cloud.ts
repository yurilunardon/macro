/**
 * The user's own Supabase project, where the copy of the data goes. The publishable key is made to
 * be inside an app: alone it opens nothing, as the bucket only lets its owner in once signed in.
 */
export const CLOUD = {
  url: 'https://jpyteqypgrvlclyrmhss.supabase.co',
  key: 'sb_publishable_0etsALtFhu0DSo4af_X-Eg_htGhnlqL',
  bucket: 'backups',
} as const;
