import requests

url = 'https://script.google.com/macros/s/AKfycbyVEcTkGnVKxvsmEvMxrKXvBrafWOG3ZzpNsqDMeChSd2JiQhRmjK9jRj-gisF97YEpeA/exec'

# Test action: update_milestone
p_update = {
    'action': 'update_milestone',
    'project_id': 'prj_001',
    'project_name': 'สุกรขุนอินทร์บุรี',
    'milestone_name': 'CPF ส่งมอบพื้นที่และยินยอมการใช้ที่ดิน ATV',
    'progress_pct': '100%'
}

r = requests.post(url, json=p_update, timeout=20)
print('update_milestone response:', r.status_code, r.text)
