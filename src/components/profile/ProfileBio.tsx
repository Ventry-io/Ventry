"use client";

import { 
  Card,
  CardContent,
  Typography
} from "@mui/material";
import { Person } from "@mui/icons-material";

interface ProfileBioProps {
  bio: string;
}

export default function ProfileBio({ bio }: ProfileBioProps) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Typography 
          variant="h6"
          component="h2"
          gutterBottom 
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 1,
            color: 'primary.main'
          }}
        >
          <Person />
          About
        </Typography>
        <Typography 
          variant="body1" 
          sx={{ 
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere'
          }}
        >
          {bio}
        </Typography>
      </CardContent>
    </Card>
  );
}