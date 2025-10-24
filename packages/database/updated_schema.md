| table_name                  | column_name                | data_type                | is_nullable | column_default                                   |
| --------------------------- | -------------------------- | ------------------------ | ----------- | ------------------------------------------------ |
| agent_actions_log           | id                         | uuid                     | NO          | gen_random_uuid()                                |
| agent_actions_log           | agent_type                 | character varying        | NO          | null                                             |
| agent_actions_log           | agent_instance_id          | uuid                     | YES         | null                                             |
| agent_actions_log           | action_type                | character varying        | NO          | null                                             |
| agent_actions_log           | user_id                    | uuid                     | YES         | null                                             |
| agent_actions_log           | context_id                 | uuid                     | YES         | null                                             |
| agent_actions_log           | context_type               | character varying        | YES         | null                                             |
| agent_actions_log           | model_used                 | character varying        | YES         | null                                             |
| agent_actions_log           | input_tokens               | integer                  | YES         | null                                             |
| agent_actions_log           | output_tokens              | integer                  | YES         | null                                             |
| agent_actions_log           | cost_usd                   | numeric                  | YES         | null                                             |
| agent_actions_log           | latency_ms                 | integer                  | YES         | null                                             |
| agent_actions_log           | input_data                 | jsonb                    | YES         | null                                             |
| agent_actions_log           | output_data                | jsonb                    | YES         | null                                             |
| agent_actions_log           | error                      | text                     | YES         | null                                             |
| agent_actions_log           | created_at                 | timestamp with time zone | YES         | now()                                            |
| agent_instances             | id                         | uuid                     | NO          | gen_random_uuid()                                |
| agent_instances             | agent_type                 | character varying        | NO          | null                                             |
| agent_instances             | user_id                    | uuid                     | YES         | null                                             |
| agent_instances             | config_json                | jsonb                    | YES         | null                                             |
| agent_instances             | prompt_version             | character varying        | YES         | null                                             |
| agent_instances             | status                     | character varying        | YES         | 'active'::character varying                      |
| agent_instances             | last_active_at             | timestamp with time zone | YES         | now()                                            |
| agent_instances             | created_at                 | timestamp with time zone | YES         | now()                                            |
| agent_instances             | terminated_at              | timestamp with time zone | YES         | null                                             |
| agent_tasks                 | id                         | uuid                     | NO          | gen_random_uuid()                                |
| agent_tasks                 | task_type                  | character varying        | NO          | null                                             |
| agent_tasks                 | agent_type                 | character varying        | NO          | null                                             |
| agent_tasks                 | user_id                    | uuid                     | YES         | null                                             |
| agent_tasks                 | context_id                 | uuid                     | YES         | null                                             |
| agent_tasks                 | context_type               | character varying        | YES         | null                                             |
| agent_tasks                 | scheduled_for              | timestamp with time zone | NO          | null                                             |
| agent_tasks                 | priority                   | character varying        | YES         | 'medium'::character varying                      |
| agent_tasks                 | status                     | character varying        | YES         | 'pending'::character varying                     |
| agent_tasks                 | retry_count                | integer                  | YES         | 0                                                |
| agent_tasks                 | max_retries                | integer                  | YES         | 3                                                |
| agent_tasks                 | last_attempted_at          | timestamp with time zone | YES         | null                                             |
| agent_tasks                 | context_json               | jsonb                    | NO          | null                                             |
| agent_tasks                 | result_json                | jsonb                    | YES         | null                                             |
| agent_tasks                 | error_log                  | text                     | YES         | null                                             |
| agent_tasks                 | created_at                 | timestamp with time zone | YES         | now()                                            |
| agent_tasks                 | created_by                 | character varying        | YES         | null                                             |
| agent_tasks                 | completed_at               | timestamp with time zone | YES         | null                                             |
| community_requests          | id                         | uuid                     | NO          | gen_random_uuid()                                |
| community_requests          | requesting_agent_type      | character varying        | NO          | null                                             |
| community_requests          | requesting_user_id         | uuid                     | YES         | null                                             |
| community_requests          | context_id                 | uuid                     | YES         | null                                             |
| community_requests          | context_type               | character varying        | YES         | null                                             |
| community_requests          | question                   | text                     | NO          | null                                             |
| community_requests          | category                   | character varying        | YES         | null                                             |
| community_requests          | expertise_needed           | ARRAY                    | YES         | null                                             |
| community_requests          | target_user_ids            | ARRAY                    | YES         | null                                             |
| community_requests          | status                     | character varying        | YES         | 'open'::character varying                        |
| community_requests          | responses_count            | integer                  | YES         | 0                                                |
| community_requests          | closed_loop_at             | timestamp with time zone | YES         | null                                             |
| community_requests          | closed_loop_message        | text                     | YES         | null                                             |
| community_requests          | created_at                 | timestamp with time zone | YES         | now()                                            |
| community_requests          | expires_at                 | timestamp with time zone | YES         | (now() + '7 days'::interval)                     |
| community_requests          | requester_context          | text                     | YES         | null                                             |
| community_requests          | desired_outcome            | character varying        | YES         | null                                             |
| community_requests          | urgency                    | character varying        | YES         | 'medium'::character varying                      |
| community_requests          | request_summary            | character varying        | YES         | null                                             |
| community_responses         | id                         | uuid                     | NO          | gen_random_uuid()                                |
| community_responses         | request_id                 | uuid                     | NO          | null                                             |
| community_responses         | user_id                    | uuid                     | NO          | null                                             |
| community_responses         | response_text              | text                     | NO          | null                                             |
| community_responses         | verbatim_answer            | text                     | NO          | null                                             |
| community_responses         | usefulness_score           | integer                  | YES         | null                                             |
| community_responses         | impact_description         | text                     | YES         | null                                             |
| community_responses         | credits_awarded            | integer                  | YES         | null                                             |
| community_responses         | credited_at                | timestamp with time zone | YES         | null                                             |
| community_responses         | status                     | character varying        | YES         | 'provided'::character varying                    |
| community_responses         | closed_loop_message        | text                     | YES         | null                                             |
| community_responses         | closed_loop_at             | timestamp with time zone | YES         | null                                             |
| community_responses         | created_at                 | timestamp with time zone | YES         | now()                                            |
| connection_requests         | id                         | uuid                     | NO          | gen_random_uuid()                                |
| connection_requests         | introducee_user_id         | uuid                     | NO          | null                                             |
| connection_requests         | requestor_user_id          | uuid                     | YES         | null                                             |
| connection_requests         | requestor_prospect_id      | uuid                     | YES         | null                                             |
| connection_requests         | requestor_name             | character varying        | NO          | null                                             |
| connection_requests         | requestor_company          | character varying        | YES         | null                                             |
| connection_requests         | requestor_title            | character varying        | YES         | null                                             |
| connection_requests         | requestor_linkedin_url     | character varying        | YES         | null                                             |
| connection_requests         | intro_context              | text                     | NO          | null                                             |
| connection_requests         | vouched_by_user_ids        | ARRAY                    | YES         | null                                             |
| connection_requests         | bounty_credits             | integer                  | YES         | 0                                                |
| connection_requests         | requestor_credits_spent    | integer                  | YES         | 0                                                |
| connection_requests         | status                     | character varying        | YES         | 'open'::character varying                        |
| connection_requests         | introducee_response        | text                     | YES         | null                                             |
| connection_requests         | feed_item_id               | uuid                     | YES         | null                                             |
| connection_requests         | intro_email                | character varying        | YES         | null                                             |
| connection_requests         | intro_completed_at         | timestamp with time zone | YES         | null                                             |
| connection_requests         | created_at                 | timestamp with time zone | YES         | now()                                            |
| connection_requests         | updated_at                 | timestamp with time zone | YES         | now()                                            |
| connection_requests         | expires_at                 | timestamp with time zone | YES         | (now() + '30 days'::interval)                    |
| conversations               | id                         | uuid                     | NO          | gen_random_uuid()                                |
| conversations               | user_id                    | uuid                     | NO          | null                                             |
| conversations               | phone_number               | character varying        | NO          | null                                             |
| conversations               | status                     | character varying        | YES         | 'active'::character varying                      |
| conversations               | conversation_summary       | text                     | YES         | null                                             |
| conversations               | last_summary_message_id    | uuid                     | YES         | null                                             |
| conversations               | created_at                 | timestamp with time zone | YES         | now()                                            |
| conversations               | updated_at                 | timestamp with time zone | YES         | now()                                            |
| conversations               | last_message_at            | timestamp with time zone | YES         | null                                             |
| conversations               | messages_since_summary     | integer                  | YES         | 0                                                |
| credit_events               | id                         | uuid                     | NO          | gen_random_uuid()                                |
| credit_events               | user_id                    | uuid                     | NO          | null                                             |
| credit_events               | event_type                 | character varying        | NO          | null                                             |
| credit_events               | amount                     | integer                  | NO          | null                                             |
| credit_events               | reference_type             | character varying        | NO          | null                                             |
| credit_events               | reference_id               | uuid                     | NO          | null                                             |
| credit_events               | idempotency_key            | character varying        | NO          | null                                             |
| credit_events               | description                | text                     | YES         | null                                             |
| credit_events               | created_at                 | timestamp with time zone | YES         | now()                                            |
| credit_events               | processed                  | boolean                  | YES         | false                                            |
| events                      | id                         | uuid                     | NO          | gen_random_uuid()                                |
| events                      | event_type                 | character varying        | NO          | null                                             |
| events                      | aggregate_id               | uuid                     | YES         | null                                             |
| events                      | aggregate_type             | character varying        | YES         | null                                             |
| events                      | payload                    | jsonb                    | NO          | null                                             |
| events                      | metadata                   | jsonb                    | YES         | null                                             |
| events                      | processed                  | boolean                  | YES         | false                                            |
| events                      | version                    | integer                  | YES         | 1                                                |
| events                      | created_at                 | timestamp with time zone | YES         | now()                                            |
| events                      | created_by                 | character varying        | YES         | null                                             |
| innovators                  | id                         | uuid                     | NO          | gen_random_uuid()                                |
| innovators                  | user_id                    | uuid                     | NO          | null                                             |
| innovators                  | company_name               | character varying        | NO          | null                                             |
| innovators                  | solution_description       | text                     | YES         | null                                             |
| innovators                  | categories                 | ARRAY                    | YES         | null                                             |
| innovators                  | target_customer_profile    | text                     | YES         | null                                             |
| innovators                  | video_url                  | character varying        | YES         | null                                             |
| innovators                  | credits_balance            | integer                  | YES         | 0                                                |
| innovators                  | active                     | boolean                  | YES         | true                                             |
| innovators                  | created_at                 | timestamp with time zone | YES         | now()                                            |
| innovators                  | warm_intro_bounty          | integer                  | YES         | 25                                               |
| intro_offers                | id                         | uuid                     | NO          | gen_random_uuid()                                |
| intro_offers                | offering_user_id           | uuid                     | NO          | null                                             |
| intro_offers                | introducee_user_id         | uuid                     | NO          | null                                             |
| intro_offers                | prospect_name              | character varying        | NO          | null                                             |
| intro_offers                | prospect_company           | character varying        | YES         | null                                             |
| intro_offers                | prospect_title             | character varying        | YES         | null                                             |
| intro_offers                | prospect_context           | text                     | YES         | null                                             |
| intro_offers                | context_type               | character varying        | NO          | null                                             |
| intro_offers                | context_id                 | uuid                     | YES         | null                                             |
| intro_offers                | status                     | character varying        | YES         | 'pending_introducee_response'::character varying |
| intro_offers                | introducee_response        | text                     | YES         | null                                             |
| intro_offers                | connector_confirmation     | text                     | YES         | null                                             |
| intro_offers                | bounty_credits             | integer                  | YES         | 0                                                |
| intro_offers                | intro_email                | character varying        | YES         | null                                             |
| intro_offers                | intro_completed_at         | timestamp with time zone | YES         | null                                             |
| intro_offers                | created_at                 | timestamp with time zone | YES         | now()                                            |
| intro_offers                | updated_at                 | timestamp with time zone | YES         | now()                                            |
| intro_offers                | expires_at                 | timestamp with time zone | YES         | (now() + '14 days'::interval)                    |
| intro_opportunities         | id                         | uuid                     | NO          | gen_random_uuid()                                |
| intro_opportunities         | connector_user_id          | uuid                     | NO          | null                                             |
| intro_opportunities         | innovator_id               | uuid                     | YES         | null                                             |
| intro_opportunities         | prospect_id                | uuid                     | YES         | null                                             |
| intro_opportunities         | prospect_name              | character varying        | NO          | null                                             |
| intro_opportunities         | prospect_company           | character varying        | YES         | null                                             |
| intro_opportunities         | prospect_title             | character varying        | YES         | null                                             |
| intro_opportunities         | prospect_linkedin_url      | character varying        | YES         | null                                             |
| intro_opportunities         | innovator_name             | character varying        | YES         | null                                             |
| intro_opportunities         | bounty_credits             | integer                  | YES         | 50                                               |
| intro_opportunities         | status                     | character varying        | YES         | 'open'::character varying                        |
| intro_opportunities         | connector_response         | text                     | YES         | null                                             |
| intro_opportunities         | feed_item_id               | uuid                     | YES         | null                                             |
| intro_opportunities         | intro_email                | character varying        | YES         | null                                             |
| intro_opportunities         | intro_scheduled_at         | timestamp with time zone | YES         | null                                             |
| intro_opportunities         | intro_completed_at         | timestamp with time zone | YES         | null                                             |
| intro_opportunities         | created_at                 | timestamp with time zone | YES         | now()                                            |
| intro_opportunities         | updated_at                 | timestamp with time zone | YES         | now()                                            |
| intro_opportunities         | expires_at                 | timestamp with time zone | YES         | null                                             |
| linkedin_research_prospects | id                         | uuid                     | NO          | gen_random_uuid()                                |
| linkedin_research_prospects | name                       | character varying        | NO          | null                                             |
| linkedin_research_prospects | company                    | character varying        | YES         | null                                             |
| linkedin_research_prospects | title                      | character varying        | YES         | null                                             |
| linkedin_research_prospects | linkedin_url               | character varying        | YES         | null                                             |
| linkedin_research_prospects | email                      | character varying        | YES         | null                                             |
| linkedin_research_prospects | mutual_connections         | jsonb                    | YES         | null                                             |
| linkedin_research_prospects | last_researched_at         | timestamp with time zone | YES         | null                                             |
| linkedin_research_prospects | users_researching          | ARRAY                    | YES         | null                                             |
| linkedin_research_prospects | created_at                 | timestamp with time zone | YES         | now()                                            |
| message_queue               | id                         | uuid                     | NO          | gen_random_uuid()                                |
| message_queue               | user_id                    | uuid                     | NO          | null                                             |
| message_queue               | agent_id                   | character varying        | NO          | null                                             |
| message_queue               | message_data               | jsonb                    | NO          | null                                             |
| message_queue               | final_message              | text                     | YES         | null                                             |
| message_queue               | scheduled_for              | timestamp with time zone | NO          | null                                             |
| message_queue               | priority                   | character varying        | YES         | 'medium'::character varying                      |
| message_queue               | status                     | character varying        | YES         | 'queued'::character varying                      |
| message_queue               | superseded_by_message_id   | uuid                     | YES         | null                                             |
| message_queue               | superseded_reason          | character varying        | YES         | null                                             |
| message_queue               | conversation_context_id    | uuid                     | YES         | null                                             |
| message_queue               | requires_fresh_context     | boolean                  | YES         | false                                            |
| message_queue               | sent_at                    | timestamp with time zone | YES         | null                                             |
| message_queue               | delivered_message_id       | uuid                     | YES         | null                                             |
| message_queue               | created_at                 | timestamp with time zone | YES         | now()                                            |
| message_queue               | sequence_id                | uuid                     | YES         | null                                             |
| message_queue               | sequence_position          | integer                  | YES         | null                                             |
| message_queue               | sequence_total             | integer                  | YES         | null                                             |
| messages                    | id                         | uuid                     | NO          | gen_random_uuid()                                |
| messages                    | conversation_id            | uuid                     | NO          | null                                             |
| messages                    | user_id                    | uuid                     | NO          | null                                             |
| messages                    | role                       | character varying        | NO          | null                                             |
| messages                    | content                    | text                     | NO          | null                                             |
| messages                    | direction                  | character varying        | NO          | null                                             |
| messages                    | twilio_message_sid         | character varying        | YES         | null                                             |
| messages                    | status                     | character varying        | YES         | null                                             |
| messages                    | created_at                 | timestamp with time zone | YES         | now()                                            |
| messages                    | sent_at                    | timestamp with time zone | YES         | null                                             |
| messages                    | delivered_at               | timestamp with time zone | YES         | null                                             |
| prospects                   | id                         | uuid                     | NO          | uuid_generate_v4()                               |
| prospects                   | email                      | text                     | YES         | null                                             |
| prospects                   | phone_number               | text                     | YES         | null                                             |
| prospects                   | linkedin_url               | text                     | YES         | null                                             |
| prospects                   | first_name                 | text                     | YES         | null                                             |
| prospects                   | last_name                  | text                     | YES         | null                                             |
| prospects                   | company                    | text                     | YES         | null                                             |
| prospects                   | title                      | text                     | YES         | null                                             |
| prospects                   | innovator_id               | uuid                     | NO          | null                                             |
| prospects                   | uploaded_at                | timestamp with time zone | NO          | now()                                            |
| prospects                   | upload_source              | text                     | YES         | null                                             |
| prospects                   | upload_batch_id            | uuid                     | YES         | null                                             |
| prospects                   | status                     | text                     | NO          | 'pending'::text                                  |
| prospects                   | converted_to_user_id       | uuid                     | YES         | null                                             |
| prospects                   | converted_at               | timestamp with time zone | YES         | null                                             |
| prospects                   | prospect_notes             | text                     | YES         | null                                             |
| prospects                   | target_solution_categories | ARRAY                    | YES         | null                                             |
| prospects                   | metadata                   | jsonb                    | YES         | null                                             |
| prospects                   | created_at                 | timestamp with time zone | NO          | now()                                            |
| prospects                   | updated_at                 | timestamp with time zone | NO          | now()                                            |
| solution_workflows          | id                         | uuid                     | NO          | gen_random_uuid()                                |
| solution_workflows          | user_id                    | uuid                     | NO          | null                                             |
| solution_workflows          | request_description        | text                     | NO          | null                                             |
| solution_workflows          | category                   | character varying        | YES         | null                                             |
| solution_workflows          | current_step               | character varying        | NO          | null                                             |
| solution_workflows          | status                     | character varying        | YES         | 'in_progress'::character varying                 |
| solution_workflows          | perplexity_results         | jsonb                    | YES         | null                                             |
| solution_workflows          | matched_innovators         | jsonb                    | YES         | null                                             |
| solution_workflows          | community_insights         | jsonb                    | YES         | null                                             |
| solution_workflows          | expert_recommendations     | jsonb                    | YES         | null                                             |
| solution_workflows          | quality_threshold_met      | boolean                  | YES         | false                                            |
| solution_workflows          | last_decision_at           | timestamp with time zone | YES         | null                                             |
| solution_workflows          | next_action                | character varying        | YES         | null                                             |
| solution_workflows          | pending_tasks              | jsonb                    | YES         | '[]'::jsonb                                      |
| solution_workflows          | completed_tasks            | jsonb                    | YES         | '[]'::jsonb                                      |
| solution_workflows          | conversation_log           | jsonb                    | YES         | '[]'::jsonb                                      |
| solution_workflows          | created_at                 | timestamp with time zone | YES         | now()                                            |
| solution_workflows          | updated_at                 | timestamp with time zone | YES         | now()                                            |
| solution_workflows          | completed_at               | timestamp with time zone | YES         | null                                             |
| user_credit_balances        | user_id                    | uuid                     | YES         | null                                             |
| user_credit_balances        | balance                    | bigint                   | YES         | null                                             |
| user_credit_balances        | transaction_count          | bigint                   | YES         | null                                             |
| user_credit_balances        | last_transaction_at        | timestamp with time zone | YES         | null                                             |
| user_message_budget         | id                         | uuid                     | NO          | gen_random_uuid()                                |
| user_message_budget         | user_id                    | uuid                     | NO          | null                                             |
| user_message_budget         | date                       | date                     | NO          | null                                             |
| user_message_budget         | messages_sent              | integer                  | YES         | 0                                                |
| user_message_budget         | last_message_at            | timestamp with time zone | YES         | null                                             |
| user_message_budget         | daily_limit                | integer                  | YES         | 5                                                |
| user_message_budget         | hourly_limit               | integer                  | YES         | 2                                                |
| user_message_budget         | quiet_hours_enabled        | boolean                  | YES         | true                                             |
| user_message_budget         | created_at                 | timestamp with time zone | YES         | now()                                            |
| user_priorities             | id                         | uuid                     | NO          | gen_random_uuid()                                |
| user_priorities             | user_id                    | uuid                     | NO          | null                                             |
| user_priorities             | priority_rank              | integer                  | NO          | null                                             |
| user_priorities             | item_type                  | character varying        | NO          | null                                             |
| user_priorities             | item_id                    | uuid                     | NO          | null                                             |
| user_priorities             | value_score                | numeric                  | YES         | null                                             |
| user_priorities             | status                     | character varying        | YES         | 'active'::character varying                      |
| user_priorities             | created_at                 | timestamp with time zone | YES         | now()                                            |
| user_priorities             | expires_at                 | timestamp with time zone | YES         | null                                             |
| user_priorities             | presented_at               | timestamp with time zone | YES         | null                                             |
| users                       | id                         | uuid                     | NO          | gen_random_uuid()                                |
| users                       | phone_number               | character varying        | NO          | null                                             |
| users                       | email                      | character varying        | YES         | null                                             |
| users                       | first_name                 | character varying        | YES         | null                                             |
| users                       | last_name                  | character varying        | YES         | null                                             |
| users                       | company                    | character varying        | YES         | null                                             |
| users                       | title                      | character varying        | YES         | null                                             |
| users                       | linkedin_url               | character varying        | YES         | null                                             |
| users                       | verified                   | boolean                  | YES         | false                                            |
| users                       | innovator                  | boolean                  | YES         | false                                            |
| users                       | expert_connector           | boolean                  | YES         | false                                            |
| users                       | expertise                  | ARRAY                    | YES         | null                                             |
| users                       | poc_agent_id               | character varying        | YES         | null                                             |
| users                       | poc_agent_type             | character varying        | YES         | null                                             |
| users                       | quiet_hours_start          | time without time zone   | YES         | null                                             |
| users                       | quiet_hours_end            | time without time zone   | YES         | null                                             |
| users                       | timezone                   | character varying        | YES         | null                                             |
| users                       | response_pattern           | jsonb                    | YES         | null                                             |
| users                       | credit_balance             | integer                  | YES         | 0                                                |
| users                       | status_level               | character varying        | YES         | 'member'::character varying                      |
| users                       | created_at                 | timestamp with time zone | YES         | now()                                            |
| users                       | updated_at                 | timestamp with time zone | YES         | now()                                            |
| users                       | last_active_at             | timestamp with time zone | YES         | null                                             |
| users                       | referred_by                | uuid                     | YES         | null                                             |
| users                       | name_dropped               | character varying        | YES         | null                                             |
| users                       | email_verified             | boolean                  | YES         | false                                            |