import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    'aiux-color-swatch|2026-f1': {
                        table: 'sys_aix_color_swatch'
                        id: 'c6cdbe58791ef8f7badfd2df5e817b17'
                    }
                    'aiux-dependency|placeholder-view.js': {
                        table: 'sys_aix_dependency'
                        id: '954d758df8411bcaa72be2132a6c6cd4'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-ai-race-intelligence-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: 'd76d56f6af75ebc9fdfdcd564a93c54a'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-command-center-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: '5e0252212fd74656c2353133c60d92bf'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-home-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: '7fc32ae4604233fe6eebf381c4d2dab1'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-incident-response-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: 'a632311aedfdd8a152d44a6f9d2477ac'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-incidents-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: 'ce1b0c6dfa1f538de207be7d572afc8a'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-live-telemetry-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: '0c659970904c3fec1d8b9aee8cafac83'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-performance-analytics-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: 'dfef5db9c370dd92e581d42fd8033440'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-post-race-review-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: '24bec29a61e819a71501dc2c658f61b7'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-race-control-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: '7b44fa8d6db7d1566874c185f33ceb08'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-race-operations-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: 'eb686b94222b570059d92c500c8abaed'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-safety-compliance-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: 'a5a549800b4c309e47002e6dd0ded394'
                    }
                    'aiux-experience-page-rel|x-snc-2026-f1-team-operations-page': {
                        table: 'sys_aix_experience_page_rel'
                        id: '314caccbcf54358273c2d62942d2f823'
                    }
                    'aiux-experience-prop|appHeadCss': {
                        table: 'sys_aix_experience_properties'
                        id: 'c3ae01a5589103b7e71bf800df9ec96f'
                    }
                    'aiux-experience-prop|appTailwindCss': {
                        table: 'sys_aix_experience_properties'
                        id: 'd8c2378d3285e1853dcc674ca50d5d3a'
                    }
                    'aiux-experience|2026-f1': {
                        table: 'sys_aix_experience'
                        id: '5a0393cd7cd64b581b17ac5a7e5acd9f'
                    }
                    'aiux-layout-widget|lifecycle': {
                        table: 'sys_aix_widget'
                        id: '688b49d13e563f0783aca5dd768bb75c'
                    }
                    'aiux-m2m-widget-dep|x-snc-2026-f1-ai-race-intelligence-page|placeholder-view.js': {
                        table: 'sys_aix_m2m_widget_dependency'
                        id: 'fad7b6d9379ea3d18671938330de43f3'
                    }
                    'aiux-m2m-widget-dep|x-snc-2026-f1-command-center-page|placeholder-view.js': {
                        table: 'sys_aix_m2m_widget_dependency'
                        id: '642885b3e4cffeedc9915a362b16f5fd'
                    }
                    'aiux-m2m-widget-dep|x-snc-2026-f1-incident-response-page|placeholder-view.js': {
                        table: 'sys_aix_m2m_widget_dependency'
                        id: '14e6c5be157d378c8dd441d581a9e053'
                    }
                    'aiux-m2m-widget-dep|x-snc-2026-f1-live-telemetry-page|placeholder-view.js': {
                        table: 'sys_aix_m2m_widget_dependency'
                        id: '02297a84f71d17ddab5bb00843d3b4fc'
                    }
                    'aiux-m2m-widget-dep|x-snc-2026-f1-performance-analytics-page|placeholder-view.js': {
                        table: 'sys_aix_m2m_widget_dependency'
                        id: '7889b6e8f1bb4533ec50747b6d996e45'
                    }
                    'aiux-m2m-widget-dep|x-snc-2026-f1-post-race-review-page|placeholder-view.js': {
                        table: 'sys_aix_m2m_widget_dependency'
                        id: 'cad5e6e83fa88b776f046ca65ac648f9'
                    }
                    'aiux-m2m-widget-dep|x-snc-2026-f1-race-operations-page|placeholder-view.js': {
                        table: 'sys_aix_m2m_widget_dependency'
                        id: '4d97dc450825e4e391c7521fea223375'
                    }
                    'aiux-m2m-widget-dep|x-snc-2026-f1-safety-compliance-page|placeholder-view.js': {
                        table: 'sys_aix_m2m_widget_dependency'
                        id: 'd8a2101d3c519e6b747e01fcab40312b'
                    }
                    'aiux-m2m-widget-dep|x-snc-2026-f1-team-operations-page|placeholder-view.js': {
                        table: 'sys_aix_m2m_widget_dependency'
                        id: '9de1557aa4196e464bf50d27e3612a19'
                    }
                    'aiux-page-widget|x-snc-2026-f1-ai-race-intelligence-page': {
                        table: 'sys_aix_widget'
                        id: 'c5b22b62e962559eb4fdd0cefb8246cd'
                    }
                    'aiux-page-widget|x-snc-2026-f1-command-center-page': {
                        table: 'sys_aix_widget'
                        id: '54d7ba80ae42bca84313b0c7b431e370'
                    }
                    'aiux-page-widget|x-snc-2026-f1-home-page': {
                        table: 'sys_aix_widget'
                        id: '122a3e499041c783de03d74c2ea95348'
                    }
                    'aiux-page-widget|x-snc-2026-f1-incident-response-page': {
                        table: 'sys_aix_widget'
                        id: 'a1d4a910c627838ccf78ea028c9a589c'
                    }
                    'aiux-page-widget|x-snc-2026-f1-incidents-page': {
                        table: 'sys_aix_widget'
                        id: 'd7999a7f15e5677dc3f6354f3c6cc63a'
                    }
                    'aiux-page-widget|x-snc-2026-f1-live-telemetry-page': {
                        table: 'sys_aix_widget'
                        id: '4ab3547a77b9c885d2c1a9286d3fc657'
                    }
                    'aiux-page-widget|x-snc-2026-f1-performance-analytics-page': {
                        table: 'sys_aix_widget'
                        id: '9f75012df2be296027747d5e264936ac'
                    }
                    'aiux-page-widget|x-snc-2026-f1-post-race-review-page': {
                        table: 'sys_aix_widget'
                        id: '673aba9811148f7f9e2780321687e4ac'
                    }
                    'aiux-page-widget|x-snc-2026-f1-race-control-page': {
                        table: 'sys_aix_widget'
                        id: '0e582ca9e5212180f70b67de7af3e09f'
                    }
                    'aiux-page-widget|x-snc-2026-f1-race-operations-page': {
                        table: 'sys_aix_widget'
                        id: '606aceb44fff5ae24a0bb31c83e1dcdc'
                    }
                    'aiux-page-widget|x-snc-2026-f1-safety-compliance-page': {
                        table: 'sys_aix_widget'
                        id: '87c4dd9ed80e8cbb04168c8508e95ead'
                    }
                    'aiux-page-widget|x-snc-2026-f1-team-operations-page': {
                        table: 'sys_aix_widget'
                        id: '0b946a5cd947bb256de81b432892e2e4'
                    }
                    'aiux-page|x-snc-2026-f1-ai-race-intelligence-page': {
                        table: 'sys_aix_page'
                        id: '3ca51767ded47df0164e2fcda919690b'
                    }
                    'aiux-page|x-snc-2026-f1-command-center-page': {
                        table: 'sys_aix_page'
                        id: 'b8535950c0a7d280b9e0b07dc09d299a'
                    }
                    'aiux-page|x-snc-2026-f1-home-page': {
                        table: 'sys_aix_page'
                        id: '9f82b6621ece9820067c8924d8398850'
                    }
                    'aiux-page|x-snc-2026-f1-incident-response-page': {
                        table: 'sys_aix_page'
                        id: 'a480d513a827a0497421c5246de1acd7'
                    }
                    'aiux-page|x-snc-2026-f1-incidents-page': {
                        table: 'sys_aix_page'
                        id: 'aca55b44cb4e8d87eeb0ab5a760ce15a'
                    }
                    'aiux-page|x-snc-2026-f1-live-telemetry-page': {
                        table: 'sys_aix_page'
                        id: 'f5a9a3732acc6f69dc78672e5b79d1ac'
                    }
                    'aiux-page|x-snc-2026-f1-performance-analytics-page': {
                        table: 'sys_aix_page'
                        id: '1316785e6c7ea0263d1dc2757c7590be'
                    }
                    'aiux-page|x-snc-2026-f1-post-race-review-page': {
                        table: 'sys_aix_page'
                        id: '1ddae1ee5a4c5b131041b1c17ca5de50'
                    }
                    'aiux-page|x-snc-2026-f1-race-control-page': {
                        table: 'sys_aix_page'
                        id: 'cf65197b0b8afa6d56ae6a068c18ed01'
                    }
                    'aiux-page|x-snc-2026-f1-race-operations-page': {
                        table: 'sys_aix_page'
                        id: '011a1e11b0e99e1f0f4717c85db05715'
                    }
                    'aiux-page|x-snc-2026-f1-safety-compliance-page': {
                        table: 'sys_aix_page'
                        id: '6b53bd7d323e94a486bd1fc7adcfcb18'
                    }
                    'aiux-page|x-snc-2026-f1-team-operations-page': {
                        table: 'sys_aix_page'
                        id: 'fd300be6ec347f25659c5063d632ea1f'
                    }
                    'aiux-project|x_snc_2026_f1': {
                        table: 'sys_aix_project'
                        id: '54ef212268acebbf5fdac9ee1804de2b'
                    }
                    'aiux-theme|2026-f1': {
                        table: 'sys_aix_theme'
                        id: '8ed69d78c5fa2628aa66cb2b90b85e16'
                    }
                    'aiux-widget|aiux-hello-world': {
                        table: 'sys_aix_widget'
                        id: '23798bcd72462f679e0a292649d660e7'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '967d0c1a204e44ff91b9905f8d4fd2dd'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '50ef0dcf1b5f4870bede1d8ce33e6614'
                    }
                }
                composite: [
                    {
                        table: 'sn_glider_source_artifact'
                        id: '3069d3fbd45444dbb85ba0175a76b97a'
                        key: {
                            name: 'aiux-source 54ef212268acebbf5fdac9ee1804de2b'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'ae58ebf42d40403d84dd5bdf3060a3c4'
                        key: {
                            application_file: '54ef212268acebbf5fdac9ee1804de2b'
                            source_artifact: '3069d3fbd45444dbb85ba0175a76b97a'
                        }
                    },
                ]
            }
        }
    }
}
