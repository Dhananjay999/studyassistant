-- Create private media storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'media',
    'media',
    false,
    10485760,
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- Users can upload to their own folder: {user_id}/{filename}
CREATE POLICY "Users can upload own media"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'media'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can view own media files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'media'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete own media files"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'media'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
