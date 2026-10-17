"use client";

import Image from "next/image";
import { BriefcaseBusiness } from "lucide-react";
import * as React from "react";
import { getCompanyInitials, getCompanyLogoPath } from "@/lib/company-brand";

interface CompanyLogoProps {
  companyName: string;
  className?: string;
  imageClassName?: string;
}

export function CompanyLogo({
  companyName,
  className = "h-11 w-11 rounded-2xl",
  imageClassName = "p-1.5",
}: CompanyLogoProps) {
  const logoPath = getCompanyLogoPath(companyName);
  const [failedPath, setFailedPath] = React.useState<string | null>(null);
  const showLogo = Boolean(logoPath && failedPath !== logoPath);
  const initials = getCompanyInitials(companyName);

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden border border-white bg-white/95 font-bold text-brand-800 shadow-sm ${className}`}
      aria-hidden="true"
    >
      {showLogo && logoPath ? (
        <Image
          src={logoPath}
          alt=""
          width={64}
          height={64}
          unoptimized
          className={`h-full w-full object-contain ${imageClassName}`}
          onError={() => setFailedPath(logoPath)}
        />
      ) : initials ? (
        <span className="text-[0.72rem] tracking-[-0.02em]">{initials}</span>
      ) : (
        <BriefcaseBusiness size={17} />
      )}
    </span>
  );
}

