import os
import uuid
import random
from datetime import datetime, timedelta
from sqlalchemy import text
from app import create_app
from models.database import get_db_manager
from models.models import Job, JobStatus

app = create_app()

def seed_data():
    db_manager = get_db_manager()
    
    # 1. Provide some dummy companies/orgs
    orgs = ["acme-corp", "stark-industries", "wayne-enterprises", "globex-corp"]
    now = datetime.utcnow()
    
    with db_manager.session_scope() as session:
        print("Creating dummy jobs via ORM...")
        
        # We'll create 5 past jobs and 1 in-progress job
        statuses = [JobStatus.COMPLETED, JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.COMPLETED, JobStatus.COMPLETED]
        
        for i, status in enumerate(statuses):
            scan_id = f"demo-scan-2024-{i+1:03d}"
            
            # Check if exists
            if session.query(Job).filter_by(id=scan_id).first():
                continue
                
            org_id = random.choice(orgs)
            
            start_time = now - timedelta(days=random.randint(1, 30), hours=random.randint(1, 12))
            
            records = random.randint(10, 500) if status == JobStatus.COMPLETED else 0
            duration_secs = random.uniform(5.0, 120.0)
            end_time = start_time + timedelta(seconds=duration_secs)
            
            err_msg = "Rate limit exceeded from HubSpot API" if status == JobStatus.FAILED else None
            
            job = Job(
                id=scan_id,
                organizationId=org_id,
                type="user",
                status=status.value,
                startTime=start_time,
                endTime=end_time,
                recordsExtracted=records,
                errorMessage=err_msg,
                config={}
            )
            session.add(job)
            
        # Add one in-progress
        sync_scan = "demo-scan-syncing-now"
        if not session.query(Job).filter_by(id=sync_scan).first():
            job2 = Job(
                id=sync_scan,
                organizationId="wayne-enterprises",
                type="user",
                status=JobStatus.RUNNING.value,  # API maps this to in_progress usually
                startTime=now - timedelta(minutes=2),
                recordsExtracted=1540,
                config={}
            )
            session.add(job2)
            
        session.commit()
        
    # Raw SQL for the DLT tables
    with db_manager.engine.begin() as conn:
        print("Creating table hubspot_deals if not exists (to ensure we can insert)...")
        # Ensure schema exists
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS hubspot_deals_dev"))
        
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS hubspot_deals_dev.hubspot_deals (
                deal_id VARCHAR(50) PRIMARY KEY,
                deal_name VARCHAR(255),
                deal_stage VARCHAR(50),
                amount NUMERIC(15,2),
                close_date TIMESTAMP,
                pipeline VARCHAR(50),
                owner_id VARCHAR(50),
                is_closed BOOLEAN,
                is_closed_won BOOLEAN,
                created_date TIMESTAMP,
                last_modified_date TIMESTAMP,
                _tenant_id VARCHAR(50),
                _extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        
        print("Inserting dummy deals...")
        stages = [
            ("appointmentscheduled", False, False),
            ("qualifiedtobuy", False, False),
            ("presentationscheduled", False, False),
            ("decisionmakerboughtin", False, False),
            ("closedwon", True, True),
            ("closedlost", True, False)
        ]
        
        adjectives = ["Strategic", "Enterprise", "Global", "Regional", "Cloud", "SaaS", "Partner"]
        nouns = ["Expansion", "Renewal", "Rollout", "Implementation", "Migration", "Upgrade"]
        
        for i in range(1, 46):
            deal_id = f"dummy-deal-{10000 + i}"
            name = f"{random.choice(orgs).title().replace('-', ' ')} {random.choice(adjectives)} {random.choice(nouns)}"
            
            stage_info = random.choice(stages)
            amount = random.choice([5000, 10000, 15000, 25000, 50000, 100000, 250000]) * (1 + random.random()*0.2)
            
            close_dt = now + timedelta(days=random.randint(-60, 60))
            
            conn.execute(text("""
                INSERT INTO hubspot_deals_dev.hubspot_deals
                (deal_id, deal_name, deal_stage, amount, close_date, pipeline, owner_id, is_closed, is_closed_won, _tenant_id, _extracted_at)
                VALUES (:did, :name, :stg, :amt, :cld, 'default', :own, :ic, :icw, :tenant, :ext)
                ON CONFLICT (deal_id) DO NOTHING
            """), {
                "did": deal_id, "name": name, "stg": stage_info[0], 
                "amt": round(amount, 2), "cld": close_dt, 
                "own": f"user-{random.randint(1,5)}",
                "ic": stage_info[1], "icw": stage_info[2],
                "tenant": random.choice(orgs), "ext": now
            })
            
    print("Dummy data seeded successfully!")

if __name__ == "__main__":
    with app.app_context():
        seed_data()
