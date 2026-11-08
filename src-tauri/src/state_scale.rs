use super::*;
use crate::scale;
use serde_json::json;
impl AppState {
    async fn ensure_scale(
        &self,
        home: &str,
        generation: u64,
        cloud: &Arc<Cloud>,
        device: &Device,
        write: bool,
    ) -> Result<()> {
        let (c, d) = self.device(home, generation, &device.did).await?;
        if !Arc::ptr_eq(cloud, &c)
            || d.model != device.model
            || d.control_did() != device.control_did()
        {
            return Err(AppError::stale());
        }
        scale::validate_device(&d)?;
        if write && d.shared_read_only {
            return Err(AppError::new(
                "permissionDenied",
                "此共享体脂秤只有查看权限。",
                false,
            ));
        }
        Ok(())
    }
    pub async fn scale_history(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        account_id: Option<String>,
        before: Option<u64>,
        start: Option<u64>,
        end: Option<u64>,
        summary: bool,
        unclaimed: bool,
    ) -> Result<scale::Report> {
        let (c, d) = self.device(&home_id, generation, &did).await?;
        scale::validate_device(&d)?;
        let now = epoch_secs();
        let upper = (now * 1000 + 999).min(end.unwrap_or(now * 1000 + 999));
        let before = before.unwrap_or(upper).min(upper);
        let start = start.unwrap_or(scale::OLDEST_MS).max(scale::OLDEST_MS);
        if before < start || end.is_some_and(|e| e > now * 1000 + 86_400_000) {
            return Err(AppError::invalid("称重历史时间范围无效。"));
        }
        let index = self.handle(&c, c.scale_index(&d).await).await?;
        let members = scale::members(&index, &c.credentials.user_id, !d.shared_read_only)?;
        let selected = scale::select(&members, account_id.as_deref(), &c.credentials.user_id)?;
        self.ensure_scale(&home_id, generation, &c, &d, false)
            .await?;
        let (records, next_before, omitted_records) = if let Some(a) = &selected {
            let raw = self
                .handle(
                    &c,
                    c.scale_records(&d, a, before, start, summary && !unclaimed, unclaimed)
                        .await,
                )
                .await?;
            scale::records(
                &raw,
                &d,
                scale::member(&index, a)?,
                unclaimed,
                start,
                before,
                if summary && !unclaimed { 14 } else { 20 },
            )?
        } else {
            (Vec::new(), None, 0)
        };
        self.ensure_scale(&home_id, generation, &c, &d, false)
            .await?;
        Ok(scale::Report {
            did,
            model: d.model,
            members,
            account_id: selected,
            records,
            fetched_at: now,
            next_before,
            omitted_records,
            can_write: !d.shared_read_only,
        })
    }
    pub async fn change_scale(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        request_id: String,
        change: scale::Change,
    ) -> Result<scale::Changed> {
        if uuid::Uuid::parse_str(&request_id).is_err() {
            return Err(AppError::invalid("操作标识无效。"));
        }
        let _gate = self.scale_write.lock().await;
        let (c, d) = self.device(&home_id, generation, &did).await?;
        self.ensure_scale(&home_id, generation, &c, &d, true)
            .await?;
        let now = epoch_secs();
        let index = self.handle(&c, c.scale_index(&d).await).await?;
        let members = scale::members(&index, &c.credentials.user_id, true)?;
        let account = match &change {
            scale::Change::SaveMember { account_id, .. } => account_id.as_deref(),
            scale::Change::RemoveMember { account_id, .. }
            | scale::Change::Claim { account_id, .. }
            | scale::Change::DeleteUnclaimed { account_id, .. }
            | scale::Change::DeleteRecords { account_id, .. } => Some(account_id.as_str()),
        };
        let profile = account
            .map(|a| scale::member(&index, a).cloned())
            .transpose()?;
        if let Some(a) = account {
            if !members.iter().any(|m| m.account_id == a && m.can_edit) {
                return Err(AppError::new(
                    "permissionDenied",
                    "只能修改当前账号有权限管理的成员资料。",
                    false,
                ));
            }
        }
        match &change {
            scale::Change::SaveMember {
                account_id,
                baseline,
                draft,
            } => {
                scale::validate_draft(draft, now * 1000)?;
                if account_id.is_some() && profile.as_ref().map(scale::fingerprint) != *baseline {
                    return Err(AppError::invalid("成员资料已发生变化，请刷新后再保存。"));
                }
                if account_id.is_none() && members.len() >= 32 {
                    return Err(AppError::invalid("成员数量已达上限。"));
                }
            }
            scale::Change::RemoveMember {
                account_id,
                baseline,
            } => {
                if account_id == &c.credentials.user_id {
                    return Err(AppError::invalid("不能删除主用户。"));
                }
                if profile.as_ref().map(scale::fingerprint).as_ref() != Some(baseline) {
                    return Err(AppError::invalid("成员资料已发生变化，请刷新。"));
                }
            }
            _ => {}
        }
        let references = match &change {
            scale::Change::Claim { records, .. }
            | scale::Change::DeleteUnclaimed { records, .. }
            | scale::Change::DeleteRecords { records, .. } => records.as_slice(),
            _ => &[],
        };
        if references.len() > 20
            || (!matches!(
                &change,
                scale::Change::SaveMember { .. } | scale::Change::RemoveMember { .. }
            ) && references.is_empty())
        {
            return Err(AppError::invalid("每次请选择 1–20 条记录。"));
        }
        let pending = !matches!(&change, scale::Change::DeleteRecords { .. });
        let mut pages = HashMap::new();
        let mut rows = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for reference in references {
            if reference.key.len() != 64
                || !reference.key.bytes().all(|c| c.is_ascii_hexdigit())
                || reference.time_ms < scale::OLDEST_MS
                || reference.time_ms > now * 1000 + 999
                || !seen.insert(&reference.key)
            {
                return Err(AppError::invalid("记录选择无效，请刷新。"));
            }
            if !pages.contains_key(&reference.time_ms) {
                let raw = self
                    .handle(
                        &c,
                        c.scale_records(
                            &d,
                            account.unwrap(),
                            reference.time_ms,
                            scale::OLDEST_MS,
                            false,
                            pending,
                        )
                        .await,
                    )
                    .await?;
                pages.insert(reference.time_ms, raw);
                self.ensure_scale(&home_id, generation, &c, &d, true)
                    .await?;
            }
            let row = pages[&reference.time_ms]
                .as_array()
                .filter(|r| r.len() <= 20)
                .and_then(|rows| rows.iter().find(|r| scale::record_key(r) == reference.key))
                .ok_or_else(|| AppError::invalid("所选记录已变更，请刷新后重新选择。"))?;
            if scale::record(
                row,
                &d,
                profile.as_ref().unwrap(),
                pending,
                scale::OLDEST_MS,
                reference.time_ms,
            )
            .is_none()
            {
                return Err(AppError::invalid("记录归属与当前成员不符。"));
            }
            rows.push(row.clone());
        }
        self.ensure_scale(&home_id, generation, &c, &d, true)
            .await?;
        let key = format!(
            "{}:{}:{}:{}:{}",
            c.credentials.region, c.credentials.user_id, generation, did, request_id
        );
        let signature =
            scale::fingerprint(&serde_json::to_value(&change).map_err(|_| AppError::protocol())?);
        {
            let mut requests = self.scale_requests.lock().await;
            requests.retain(|_, (t, _)| now.saturating_sub(*t) < 900);
            if let Some((_, old)) = requests.get(&key) {
                if old != &signature {
                    return Err(AppError::invalid("操作标识已被使用。"));
                }
                return Ok(scale::Changed {
                    confirmed: false,
                    message: "该操作已提交过，请刷新确认，不会重复提交。".into(),
                    completed: 0,
                });
            }
            if requests.len() >= 256 {
                return Err(AppError::invalid("操作较多，请稍后刷新再试。"));
            }
            requests.insert(key, (now, signature));
        }
        let mut completed = 0;
        let result:Result<()>=async{match &change{
   scale::Change::SaveMember{draft,..}=>{let mut value=scale::make_member(draft,profile.as_ref(),&d,&c.credentials.user_id,now*1000);if profile.is_none()&&!members.iter().any(|m|m.master){value["type"]=json!(1);}self.ensure_scale(&home_id,generation,&c,&d,true).await?;let path=if profile.is_some(){"/eco/scale/account/update"}else{"/eco/scale/account/add"};let reply=self.handle(&c,c.scale_call(&d,path,value).await).await?;completed=1;if profile.is_none(){let new_id=scale::id(&reply["accountId"]).ok_or_else(AppError::protocol)?;self.ensure_scale(&home_id,generation,&c,&d,true).await?;self.handle(&c,c.scale_call(&d,"/eco/scale/account/addAccountCode",json!({"accountId":new_id,"userId":c.credentials.user_id,"deviceId":d.control_did()})).await).await?;}},
   scale::Change::RemoveMember{account_id,..}=>{self.handle(&c,c.scale_call(&d,"/eco/scale/account/remove",json!({"accountId":account_id,"uid":c.credentials.user_id,"source":2})).await).await?;completed=1;},
   _=>{let user=profile.as_ref().unwrap();for row in &rows{self.ensure_scale(&home_id,generation,&c,&d,true).await?;let mut data=scale::data(row).ok_or_else(AppError::protocol)?;let path=match &change{
    scale::Change::Claim{..}=>{if scale::number(&data["bfp"]).is_none()&&scale::number(&data["bodyRes"]).is_some()&&scale::number(&data["bodyRes2"]).is_some(){let param=scale::calculation(user,&data,now*1000).ok_or_else(||AppError::invalid("请先在成员管理中完善性别、生日和身高，再认领体脂记录。"))?;let calculated=self.handle(&c,c.scale_call(&d,"/eco/scale/batch_bcalc",json!([param])).await).await?;let values=calculated.as_array().filter(|v|v.len()==1).and_then(|v|v.first()).ok_or_else(AppError::protocol)?;for field in scale::FIELDS{if let Some(v)=values.get(*field){data[*field]=v.clone();}}}data["weight"]=json!(scale::number(&data["weight"]).ok_or_else(AppError::protocol)?);if let Some(n)=scale::number(&data["heartRate"]){data["heartRate"]=json!(n.trunc() as u64);}if let Some(n)=scale::number(&data["time"]){data["time"]=json!(n.trunc() as u64);}data["user"]=user.clone();data["miid"]=json!(c.credentials.user_id);data["duid"]=user["accountCode"].clone();data["userType"]=user["type"].clone();data["reportFrom"]=json!("Claimed");"/eco/common/scale/add"},
    scale::Change::DeleteUnclaimed{..}=>"/eco/common/scale/addClaimDel",scale::Change::DeleteRecords{..}=>"/eco/common/scale/remove",_=>unreachable!()};
    self.ensure_scale(&home_id,generation,&c,&d,true).await?;let payload=json!({"uid":c.credentials.user_id,"accountId":account.unwrap(),"did":d.control_did(),"model":d.model,"dataVersion":1,"fromSource":2,"sn":row["sn"].as_str().unwrap_or(""),"data":if matches!(&change,scale::Change::Claim{..}){serde_json::to_string(&data).map_err(|_|AppError::protocol())?}else{match &row["data"]{Value::String(s)=>s.clone(),v=>serde_json::to_string(v).map_err(|_|AppError::protocol())?}},"createTime":scale::millis(&row["createTime"]).ok_or_else(AppError::protocol)?});
    self.handle(&c,c.scale_call(&d,path,payload).await).await?;completed+=1;
   }}
  }Ok(())}.await;
        self.ensure_scale(&home_id, generation, &c, &d, false)
            .await?;
        match result {
            Ok(()) => Ok(scale::Changed {
                confirmed: true,
                message: match change {
                    scale::Change::SaveMember { .. } => "成员资料已保存",
                    scale::Change::RemoveMember { .. } => "成员已删除",
                    scale::Change::Claim { .. } => "认领已提交，正在刷新记录",
                    _ => "删除已提交，正在刷新记录",
                }
                .into(),
                completed,
            }),
            Err(e) => Ok(scale::Changed {
                confirmed: false,
                message: format!(
                    "已完成 {completed} 项，其余结果未确认：{} 请刷新核对，勿重复提交。",
                    e.message
                ),
                completed,
            }),
        }
    }
}
