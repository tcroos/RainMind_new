"use client";

import { useEffect, useRef, type VideoHTMLAttributes } from "react";

type CreativeHoverVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "autoPlay" | "controls" | "muted" | "onMouseEnter" | "onMouseLeave" | "playsInline" | "preload"> & {
    autoPlay?: boolean;
    preload?: VideoHTMLAttributes<HTMLVideoElement>["preload"];
};

export function CreativeHoverVideo({ autoPlay = false, preload = "auto", ...props }: CreativeHoverVideoProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (!autoPlay) return;
        const video = videoRef.current;
        if (!video) return;
        void video.play().catch(() => undefined);
        return () => {
            video.pause();
            if (video.readyState > 0) video.currentTime = 0;
        };
    }, [autoPlay]);

    return (
        <video
            {...props}
            ref={videoRef}
            autoPlay={autoPlay}
            controls={false}
            muted
            playsInline
            preload={preload}
            onMouseEnter={() => {
                const video = videoRef.current;
                if (!video) return;
                if (video.readyState > 0) video.currentTime = 0;
                void video.play().catch(() => undefined);
            }}
            onMouseLeave={() => {
                const video = videoRef.current;
                if (!video) return;
                video.pause();
                if (video.readyState > 0) video.currentTime = 0;
            }}
        />
    );
}
